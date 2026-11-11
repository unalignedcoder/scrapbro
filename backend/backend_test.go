package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func start(t *testing.T, pwd string) *server {
	t.Helper()
	s, err := startServer("127.0.0.1:0", pwd)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.close)
	return s
}

func post(t *testing.T, s *server, path string, form url.Values, headers ...string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest("POST", "http://"+s.addr+path, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for i := 0; i+1 < len(headers); i += 2 {
		if headers[i] == "Host" {
			req.Host = headers[i+1]
		} else {
			req.Header.Set(headers[i], headers[i+1])
		}
	}
	return do(t, req)
}

func get(t *testing.T, s *server, path string) (int, string, http.Header) {
	t.Helper()
	req, _ := http.NewRequest("GET", "http://"+s.addr+path, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b), res.Header
}

func do(t *testing.T, req *http.Request) (int, string) {
	t.Helper()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

/** file-service url of a local path, like the extension builds it */
func serviceURL(pwd, p string) string {
	if pwd == "" {
		pwd = "empty"
	}
	return "/file-service/pwd/" + pwd + "/" + filepath.ToSlash(p)
}

func TestSaveAndServe(t *testing.T) {
	s := start(t, "")
	dir := t.TempDir()
	name := filepath.Join(dir, "data", "123", "index.html")

	if code, body := post(t, s, "/isfile/", url.Values{"path": {name}}); code != 200 || body != "no" {
		t.Fatalf("isfile before save: %d %q", code, body)
	}
	if code, body := post(t, s, "/savefile", url.Values{"filename": {name}, "content": {"<p>héllo</p>"}}); code != 200 || body != "ok" {
		t.Fatalf("savefile: %d %q", code, body)
	}
	if code, body := post(t, s, "/isfile/", url.Values{"path": {name}}); body != "yes" {
		t.Fatalf("isfile after save: %d %q", code, body)
	}
	code, body, h := get(t, s, serviceURL("", name)+"?scrapbee_refresh=1")
	if code != 200 || body != "<p>héllo</p>" {
		t.Fatalf("file-service: %d %q", code, body)
	}
	if ct := h.Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Errorf("content type %q", ct)
	}
	/** a page with its own charset keeps it */
	os.WriteFile(name, []byte(`<meta charset="iso-8859-1"><p>x</p>`), 0o644)
	if _, _, h := get(t, s, serviceURL("", name)); h.Get("Content-Type") != "text/html" {
		t.Errorf("content type with meta charset %q", h.Get("Content-Type"))
	}
	if code, _, _ := get(t, s, serviceURL("", filepath.Join(dir, "missing.html"))); code != 404 {
		t.Errorf("missing file: %d", code)
	}
	if code, _ := post(t, s, "/savefile", url.Values{"filename": {"relative/x.txt"}, "content": {"x"}}); code != 400 {
		t.Errorf("relative path accepted: %d", code)
	}
	/** no temp files left */
	entries, _ := os.ReadDir(filepath.Dir(name))
	if len(entries) != 1 {
		t.Errorf("files in folder: %d", len(entries))
	}
}

func TestSaveBinFile(t *testing.T) {
	s := start(t, "")
	name := filepath.Join(t.TempDir(), "data", "1", "favicon.ico")
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	mw.WriteField("filename", name)
	fw, _ := mw.CreateFormFile("file", "blob")
	fw.Write([]byte{0, 1, 2, 255})
	mw.Close()
	req, _ := http.NewRequest("POST", "http://"+s.addr+"/savebinfile", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if code, body := do(t, req); code != 200 {
		t.Fatalf("savebinfile: %d %q", code, body)
	}
	if b, _ := os.ReadFile(name); !bytes.Equal(b, []byte{0, 1, 2, 255}) {
		t.Errorf("content %v", b)
	}
}

func TestDownloadDataURL(t *testing.T) {
	s := start(t, "")
	name := filepath.Join(t.TempDir(), "icon.png")
	code, body := post(t, s, "/download", url.Values{"filename": {name}, "url": {"data:image/png;base64,aGVsbG8="}})
	if code != 200 || body != name {
		t.Fatalf("download: %d %q", code, body)
	}
	if b, _ := os.ReadFile(name); string(b) != "hello" {
		t.Errorf("content %q", b)
	}
	if code, _ := post(t, s, "/download", url.Values{"filename": {name}, "url": {"file:///etc/passwd"}}); code != 400 {
		t.Errorf("file url accepted: %d", code)
	}
}

func TestCopyMoveDelete(t *testing.T) {
	s := start(t, "")
	dir := t.TempDir()
	src := filepath.Join(dir, "a", "data", "1")
	os.MkdirAll(filepath.Join(src, "sub"), 0o755)
	os.WriteFile(filepath.Join(src, "index.html"), []byte("page"), 0o644)
	os.WriteFile(filepath.Join(src, "sub", "img.png"), []byte("img"), 0o644)

	copied := filepath.Join(dir, "b", "data", "1")
	if code, body := post(t, s, "/fs/copy", url.Values{"src": {src}, "dest": {copied}}); body != "ok" {
		t.Fatalf("copy: %d %q", code, body)
	}
	if b, _ := os.ReadFile(filepath.Join(copied, "sub", "img.png")); string(b) != "img" {
		t.Errorf("copied content %q", b)
	}
	moved := filepath.Join(dir, "c", "data", "1")
	if code, body := post(t, s, "/fs/move", url.Values{"src": {copied}, "dest": {moved}}); body != "ok" {
		t.Fatalf("move: %d %q", code, body)
	}
	if _, err := os.Stat(copied); !os.IsNotExist(err) {
		t.Errorf("source still there after move")
	}
	if b, _ := os.ReadFile(filepath.Join(moved, "index.html")); string(b) != "page" {
		t.Errorf("moved content %q", b)
	}
	if code, _ := post(t, s, "/fs/copy", url.Values{"src": {src}, "dest": {filepath.Join(src, "sub", "x")}}); code != 500 {
		t.Errorf("copy into itself: %d", code)
	}
	if code, body := post(t, s, "/deletedir/", url.Values{"path": {moved}}); body != "ok" {
		t.Fatalf("deletedir: %d %q", code, body)
	}
	if _, err := os.Stat(moved); !os.IsNotExist(err) {
		t.Errorf("folder still there after delete")
	}
	root := filepath.VolumeName(dir) + string(filepath.Separator)
	if code, _ := post(t, s, "/deletedir/", url.Values{"path": {root}}); code != 400 {
		t.Errorf("delete of root accepted: %d", code)
	}
}

func TestPassword(t *testing.T) {
	s := start(t, "secret1")
	name := filepath.Join(t.TempDir(), "x.txt")
	if code, _ := post(t, s, "/savefile", url.Values{"filename": {name}, "content": {"x"}}); code != 403 {
		t.Errorf("no password: %d", code)
	}
	if code, _ := post(t, s, "/savefile", url.Values{"filename": {name}, "content": {"x"}, "pwd": {"secret1"}}); code != 200 {
		t.Errorf("with password: %d", code)
	}
	if code, _, _ := get(t, s, serviceURL("", name)); code != 403 {
		t.Errorf("file-service without password: %d", code)
	}
	if code, body, _ := get(t, s, serviceURL("secret1", name)); code != 200 || body != "x" {
		t.Errorf("file-service with password: %d %q", code, body)
	}
	if code, _, _ := get(t, s, "/serverinfo/?pwd=secret1"); code != 200 {
		t.Errorf("serverinfo: %d", code)
	}
	if _, err := startServer("127.0.0.1:0", "bad pwd!"); err == nil {
		t.Errorf("invalid password accepted")
	}
}

func TestOriginAndHost(t *testing.T) {
	s := start(t, "")
	name := filepath.Join(t.TempDir(), "x.txt")
	form := url.Values{"filename": {name}, "content": {"x"}}
	for _, c := range []struct {
		headers []string
		code    int
	}{
		{nil, 200},
		{[]string{"Origin", "chrome-extension://abcdefghijklmnop"}, 200},
		{[]string{"Origin", "moz-extension://8f3c-uuid"}, 200},
		{[]string{"Origin", "http://" + s.addr}, 200}, // pages served by file-service
		{[]string{"Origin", "https://evil.example"}, 403},
		{[]string{"Origin", "null"}, 403},
		{[]string{"Host", "evil.example"}, 403}, // dns rebinding
		{[]string{"Host", "localhost:1234"}, 200},
	} {
		if code, body := post(t, s, "/savefile", form, c.headers...); code != c.code {
			t.Errorf("%v: %d %q, want %d", c.headers, code, body, c.code)
		}
	}
}

func TestServicePath(t *testing.T) {
	if os.PathSeparator == '\\' {
		for in, want := range map[string]string{"C:/x/y.html": `C:\x\y.html`, "/C:/x//data/y": `C:\x\data\y`, "//srv/share/x": `\\srv\share\x`} {
			if got, err := servicePath(in); err != nil || got != want {
				t.Errorf("%q: %q %v, want %q", in, got, err, want)
			}
		}
	} else {
		for in, want := range map[string]string{"home/u/x.html": "/home/u/x.html", "/home/u//data/x": "/home/u/data/x"} {
			if got, err := servicePath(in); err != nil || got != want {
				t.Errorf("%q: %q %v, want %q", in, got, err, want)
			}
		}
	}
}

/* ---- native messaging ---- */

func frame(v any) []byte {
	b, _ := json.Marshal(v)
	head := make([]byte, 4)
	binary.LittleEndian.PutUint32(head, uint32(len(b)))
	return append(head, b...)
}

func readReply(t *testing.T, r io.Reader) nativeReply {
	t.Helper()
	raw, err := readMessage(r)
	if err != nil {
		t.Fatal(err)
	}
	var rep nativeReply
	if err := json.Unmarshal(raw, &rep); err != nil {
		t.Fatal(err)
	}
	return rep
}

func TestNative(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	_, busyPort, _ := net.SplitHostPort(busy.Addr().String())

	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- runNative(inR, outW); outW.Close() }()

	/** the extension sends the command as a JSON encoded string */
	cmd, _ := json.Marshal(map[string]string{"command": "web-server", "addr": "127.0.0.1:" + busyPort, "port": busyPort, "pwd": ""})
	go inW.Write(frame(string(cmd)))
	if rep := readReply(t, outR); rep.Serverstate != "fail" || rep.Error == "0" {
		t.Fatalf("busy port: %+v", rep)
	}
	/** plain object, port chosen by the system */
	go inW.Write(frame(map[string]any{"command": "web-server", "addr": "127.0.0.1:0"}))
	rep := readReply(t, outR)
	if rep.Serverstate != "ok" || rep.Version != version || rep.Serveraddr == "" {
		t.Fatalf("free port: %+v", rep)
	}
	res, err := http.Get("http://" + rep.Serveraddr + "/serverinfo/")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	go inW.Write(frame(map[string]string{"command": "nope"}))
	if rep := readReply(t, outR); rep.Serverstate != "fail" {
		t.Errorf("unknown command: %+v", rep)
	}
	/** browser closes stdin: exit without error, server stopped */
	inW.Close()
	if err := <-done; err != nil {
		t.Errorf("runNative: %v", err)
	}
	if _, err := http.Get("http://" + rep.Serveraddr + "/serverinfo/"); err == nil {
		t.Errorf("server still running after exit")
	}
}
