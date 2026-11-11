package main

// HTTP API used by the extension (compatible with the ScrapBee backend 1.7):
//
//   GET  /serverinfo/?pwd=                      JSON status
//   GET  /file-service/pwd/<pwd|empty>/<path>    serves a file of the disk (saved pages, RDF files)
//   POST /isfile/       path                     "yes" / "no"
//   POST /savefile      filename, content        writes a text file
//   POST /savebinfile   filename, file           writes an uploaded file
//   POST /download      filename, url            downloads an http(s) or data: url to a file
//   POST /fs/copy       src, dest                copies a file or folder
//   POST /fs/move       src, dest                moves a file or folder
//   POST /deletedir/    path                     deletes a folder
//   POST /filemanager/  path                     shows the folder in the file manager of the system
//
// POST values come as multipart or urlencoded form, all carry "pwd" when a password is set.
// Errors are answered with a non-2xx status and the message as text.

import (
	"bytes"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

type server struct {
	pwd      string
	addr     string
	loopback bool // listening on a loopback address only: also check the Host header (DNS rebinding)
	http     *http.Server
	routes   map[string]http.HandlerFunc
	done     chan struct{}
}

var validPassword = regexp.MustCompile(`^[0-9A-Za-z]*$`)

func newServer(pwd string) *server {
	s := &server{pwd: pwd, done: make(chan struct{})}
	s.routes = map[string]http.HandlerFunc{
		"/serverinfo":  s.serverInfo,
		"/isfile":      s.isFile,
		"/savefile":    s.saveFile,
		"/savebinfile": s.saveBinFile,
		"/download":    s.download,
		"/fs/copy":     s.copy,
		"/fs/move":     s.move,
		"/deletedir":   s.deleteDir,
		"/filemanager": s.fileManager,
	}
	return s
}

func startServer(addr, pwd string) (*server, error) {
	if !validPassword.MatchString(pwd) {
		return nil, errors.New("invalid password: only letters and digits are allowed")
	}
	/** bind before answering, so a busy port is reported to the extension, which then tries another one */
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	s := newServer(pwd)
	s.addr = ln.Addr().String()
	if a, ok := ln.Addr().(*net.TCPAddr); ok {
		s.loopback = a.IP.IsLoopback()
	}
	s.http = &http.Server{Handler: s, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		defer close(s.done)
		if err := s.http.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Println("http:", err)
		}
	}()
	logger.Printf("listening on %s", s.addr)
	return s, nil
}

func (s *server) close() {
	s.http.Close()
	<-s.done
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !s.allowed(w, r) {
		return
	}
	if rest, ok := strings.CutPrefix(r.URL.Path, "/file-service/"); ok {
		s.fileService(w, r, rest)
		return
	}
	h := s.routes[strings.TrimSuffix(r.URL.Path, "/")]
	if h == nil {
		http.NotFound(w, r)
		return
	}
	if !s.checkPwd(r.FormValue("pwd")) {
		fail(w, http.StatusForbidden, errors.New("WRONG PASSWORD"))
		return
	}
	h(w, r)
}

/** only the extension (and the pages served by file-service itself) may talk to the backend, not other web pages */
func (s *server) allowed(w http.ResponseWriter, r *http.Request) bool {
	if s.loopback {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		host = strings.Trim(host, "[]")
		if host != "localhost" && net.ParseIP(host) == nil {
			logger.Printf("refused request for host %q", r.Host)
			http.Error(w, "forbidden host", http.StatusForbidden)
			return false
		}
	}
	origin := r.Header.Get("Origin")
	if origin == "" || strings.HasPrefix(origin, "chrome-extension://") || strings.HasPrefix(origin, "moz-extension://") {
		return true
	}
	if u, err := url.Parse(origin); err == nil && u.Host == r.Host {
		return true
	}
	logger.Printf("refused request from origin %q to %s", origin, r.URL.Path)
	http.Error(w, "forbidden origin", http.StatusForbidden)
	return false
}

func (s *server) checkPwd(pwd string) bool {
	return s.pwd == "" || subtle.ConstantTimeCompare([]byte(pwd), []byte(s.pwd)) == 1
}

func fail(w http.ResponseWriter, status int, err error) {
	logger.Println(err)
	http.Error(w, err.Error(), status)
}

func reply(w http.ResponseWriter, text string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	io.WriteString(w, text)
}

/** absolute path from a form value, the extension mixes / and \ on windows */
func localPath(p string) (string, error) {
	if p == "" {
		return "", errors.New("missing path")
	}
	p = filepath.Clean(filepath.FromSlash(p))
	if !filepath.IsAbs(p) {
		return "", fmt.Errorf("not an absolute path: %s", p)
	}
	return p, nil
}

func formPaths(r *http.Request, names ...string) ([]string, error) {
	paths := make([]string, len(names))
	for i, n := range names {
		p, err := localPath(r.FormValue(n))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", n, err)
		}
		paths[i] = p
	}
	return paths, nil
}

/* ---- handlers ---- */

func (s *server) serverInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(nativeReply{Version: version, Rdfloaded: "0", Serveraddr: s.addr, Serverstate: "ok", Downloadjs: "0", Error: "0"})
}

func (s *server) isFile(w http.ResponseWriter, r *http.Request) {
	p, err := localPath(r.FormValue("path"))
	if err == nil {
		if fi, err := os.Stat(p); err == nil && fi.Mode().IsRegular() {
			reply(w, "yes")
			return
		}
	}
	reply(w, "no")
}

func (s *server) saveFile(w http.ResponseWriter, r *http.Request) {
	ps, err := formPaths(r, "filename")
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	if err := writeFileAtomic(ps[0], strings.NewReader(r.FormValue("content"))); err != nil {
		fail(w, http.StatusInternalServerError, err)
		return
	}
	reply(w, "ok")
}

func (s *server) saveBinFile(w http.ResponseWriter, r *http.Request) {
	ps, err := formPaths(r, "filename")
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		fail(w, http.StatusBadRequest, fmt.Errorf("file: %w", err))
		return
	}
	defer file.Close()
	if err := writeFileAtomic(ps[0], file); err != nil {
		fail(w, http.StatusInternalServerError, err)
		return
	}
	reply(w, "ok")
}

var downloadClient = &http.Client{Timeout: 2 * time.Minute}

func (s *server) download(w http.ResponseWriter, r *http.Request) {
	ps, err := formPaths(r, "filename")
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	src := r.FormValue("url")
	var body io.Reader
	if strings.HasPrefix(src, "data:") {
		data, err := decodeDataURL(src)
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		body = bytes.NewReader(data)
	} else if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		res, err := downloadClient.Get(src)
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			fail(w, http.StatusBadGateway, fmt.Errorf("download %s: %s", src, res.Status))
			return
		}
		body = res.Body
	} else {
		fail(w, http.StatusBadRequest, fmt.Errorf("unsupported url: %.50s", src))
		return
	}
	if err := writeFileAtomic(ps[0], body); err != nil {
		fail(w, http.StatusInternalServerError, err)
		return
	}
	reply(w, ps[0])
}

func decodeDataURL(u string) ([]byte, error) {
	meta, payload, ok := strings.Cut(strings.TrimPrefix(u, "data:"), ",")
	if !ok {
		return nil, errors.New("invalid data url")
	}
	if strings.HasSuffix(meta, ";base64") {
		return base64.StdEncoding.DecodeString(payload)
	}
	s, err := url.PathUnescape(payload)
	return []byte(s), err
}

func (s *server) copy(w http.ResponseWriter, r *http.Request) {
	ps, err := formPaths(r, "src", "dest")
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	if err := copyTree(ps[0], ps[1]); err != nil {
		fail(w, http.StatusInternalServerError, err)
		return
	}
	reply(w, "ok")
}

func (s *server) move(w http.ResponseWriter, r *http.Request) {
	ps, err := formPaths(r, "src", "dest")
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	if err := moveTree(ps[0], ps[1]); err != nil {
		fail(w, http.StatusInternalServerError, err)
		return
	}
	reply(w, "ok")
}

func (s *server) deleteDir(w http.ResponseWriter, r *http.Request) {
	ps, err := formPaths(r, "path")
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	p := ps[0]
	if filepath.Dir(p) == p {
		fail(w, http.StatusBadRequest, fmt.Errorf("refusing to delete %s", p))
		return
	}
	if fi, err := os.Stat(p); err == nil && fi.IsDir() {
		if err := os.RemoveAll(p); err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
	}
	reply(w, "ok")
}

func (s *server) fileManager(w http.ResponseWriter, r *http.Request) {
	ps, err := formPaths(r, "path")
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	dir := ps[0]
	if fi, err := os.Stat(dir); err != nil {
		fail(w, http.StatusNotFound, err)
		return
	} else if !fi.IsDir() {
		dir = filepath.Dir(dir)
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	if err := cmd.Start(); err != nil {
		fail(w, http.StatusInternalServerError, err)
		return
	}
	go cmd.Wait()
	reply(w, "ok")
}

/* ---- file service ---- */

var driveLetter = regexp.MustCompile(`^/+[A-Za-z]:`)

/** path part of a file-service url to a path of the disk */
func servicePath(p string) (string, error) {
	if runtime.GOOS == "windows" {
		if driveLetter.MatchString(p) {
			p = strings.TrimLeft(p, "/") // ".../empty//C:/x" -> "C:/x", keep "//server/share" (UNC)
		}
	} else if !strings.HasPrefix(p, "/") {
		p = "/" + p // the extension drops the leading slash of unix paths
	}
	return localPath(p)
}

func (s *server) fileService(w http.ResponseWriter, r *http.Request, rest string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rest, ok := strings.CutPrefix(rest, "pwd/")
	pwd, p, ok2 := strings.Cut(rest, "/")
	if !ok || !ok2 {
		http.NotFound(w, r)
		return
	}
	if pwd == "empty" {
		pwd = ""
	}
	if !s.checkPwd(pwd) {
		fail(w, http.StatusForbidden, errors.New("WRONG PASSWORD"))
		return
	}
	name, err := servicePath(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil || fi.IsDir() {
		http.NotFound(w, r)
		return
	}
	if t := contentType(name, f); t != "" {
		w.Header().Set("Content-Type", t)
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, fi.Name(), fi.ModTime(), f)
}

/** fixed types for what scrapbooks contain, the windows registry has odd entries on some systems */
var contentTypes = map[string]string{
	".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
	".json": "application/json", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".rdf": "application/xml",
	".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
	".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp", ".ico": "image/x-icon",
	".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
	".mp3": "audio/mpeg", ".mp4": "video/mp4", ".webm": "video/webm", ".pdf": "application/pdf",
}

func contentType(name string, f *os.File) string {
	ext := strings.ToLower(filepath.Ext(name))
	if ext == ".html" || ext == ".htm" || ext == ".xhtml" {
		/** pages saved by ScrapBee/ScrapBro are utf-8, older ScrapBook pages declare their charset in a meta tag,
		    which the browser only honours when the header has no charset */
		head := make([]byte, 2048)
		n, _ := io.ReadFull(f, head)
		f.Seek(0, io.SeekStart)
		if bytes.Contains(bytes.ToLower(head[:n]), []byte("charset")) {
			return "text/html"
		}
		return "text/html; charset=utf-8"
	}
	return contentTypes[ext]
}

/* ---- file system ---- */

/** write to a temporary file and rename it, a crash can not leave a half written RDF behind */
func writeFileAtomic(name string, data io.Reader) error {
	dir := filepath.Dir(name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".scrapbro-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // nothing left to remove after the rename
	if _, err := io.Copy(tmp, data); err != nil {
		tmp.Close()
		return err
	}
	tmp.Chmod(0o644)
	if err := tmp.Close(); err != nil {
		return err
	}
	return renameRetry(tmp.Name(), name)
}

/** on windows a file that is being read (e.g. served to the browser) can not be replaced for a moment */
func renameRetry(src, dest string) error {
	var err error
	for i := 0; i < 10; i++ {
		if err = os.Rename(src, dest); err == nil || runtime.GOOS != "windows" {
			return err
		}
		time.Sleep(50 * time.Millisecond)
	}
	return err
}

func copyTree(src, dest string) error {
	fi, err := os.Stat(src)
	if err != nil {
		return err
	}
	if inside(dest, src) {
		return fmt.Errorf("can not copy %s into itself", src)
	}
	if !fi.IsDir() {
		return copyFile(src, dest, fi)
	}
	return filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(dest, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		return copyFile(p, target, info)
	})
}

func copyFile(src, dest string, fi os.FileInfo) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := writeFileAtomic(dest, in); err != nil {
		return err
	}
	return os.Chtimes(dest, time.Now(), fi.ModTime())
}

func moveTree(src, dest string) error {
	if _, err := os.Stat(src); err != nil {
		return err
	}
	if inside(dest, src) {
		return fmt.Errorf("can not move %s into itself", src)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(dest); errors.Is(err, os.ErrNotExist) {
		if err := os.Rename(src, dest); err == nil {
			return nil
		}
	}
	/** other drive, or merging into an existing folder */
	if err := copyTree(src, dest); err != nil {
		return err
	}
	return os.RemoveAll(src)
}

/** is p the same as or below dir */
func inside(p, dir string) bool {
	rel, err := filepath.Rel(dir, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
