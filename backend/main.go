// scrapbro_backend is the native helper of the ScrapBro browser extension.
//
// The browser starts it through native messaging (stdin/stdout), the extension then asks it to
// serve a small HTTP API on 127.0.0.1 that reads and writes scrapbooks on disk (see server.go).
// It can also run on its own:  scrapbro_backend web-server [port] [host] [password]
package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
)

// version reported to the extension. The API is the one of the ScrapBee backend 1.7,
// the extension enables all features for versions >= 1.7.3.
const version = "2.0.0"

const maxMessageSize = 1 << 20

var logger = log.New(io.Discard, "", log.LstdFlags)

func main() {
	args := os.Args[1:]
	if len(args) > 0 {
		switch args[0] {
		case "-h", "--help", "help":
			printHelp()
			return
		case "-v", "--version", "version":
			fmt.Println("scrapbro_backend " + version)
			return
		case "web-server":
			openLog()
			os.Exit(runStandalone(args[1:]))
		}
		// anything else are the arguments browsers pass to native hosts (extension origin, manifest path, ...)
	}
	openLog()
	logger.Printf("scrapbro_backend %s started by the browser", version)
	if err := runNative(os.Stdin, os.Stdout); err != nil {
		logger.Println("native messaging:", err)
		os.Exit(1)
	}
}

func printHelp() {
	fmt.Print(`scrapbro_backend ` + version + `, backend of the ScrapBro browser extension

usage:
  scrapbro_backend                                  native messaging mode, started by the browser
  scrapbro_backend web-server [port] [host] [pwd]   run the HTTP service on its own
  scrapbro_backend --version

web-server arguments:
  port   default 9900
  host   default 127.0.0.1
  pwd    optional password (letters and digits), the same must be set in the extension

The log is written to scrapbro_backend.log next to the program.
`)
}

/** log next to the executable, restarted when it grows over 1 MB; no log if the folder is read-only */
func openLog() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	name := filepath.Join(filepath.Dir(exe), "scrapbro_backend.log")
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if fi, err := os.Stat(name); err == nil && fi.Size() > 1<<20 {
		flags |= os.O_TRUNC
	}
	f, err := os.OpenFile(name, flags, 0o644)
	if err != nil {
		return
	}
	logger.SetOutput(f)
}

func runStandalone(args []string) int {
	port, host, pwd := "9900", "127.0.0.1", ""
	if len(args) > 0 {
		port = args[0]
	}
	if len(args) > 1 {
		host = args[1]
	}
	if len(args) > 2 {
		pwd = args[2]
	}
	s, err := startServer(net.JoinHostPort(host, port), pwd)
	if err != nil {
		fmt.Fprintln(os.Stderr, "failed to start:", err)
		return 1
	}
	fmt.Printf("ScrapBro backend %s listening on http://%s/ (Ctrl+C to stop)\n", version, s.addr)
	if pwd != "" {
		fmt.Println("password protected")
	}
	<-s.done
	return 0
}

/* ---- native messaging: 4 byte length (native byte order, little endian on all supported systems) + JSON ---- */

// reply to the "web-server" command, the field names are the ones the extension reads
type nativeReply struct {
	Version     string
	Rdfloaded   string
	Serveraddr  string
	Serverstate string
	Downloadjs  string
	Error       string
}

func runNative(in io.Reader, out io.Writer) error {
	var current *server
	defer func() {
		if current != nil {
			current.close()
		}
	}()
	for {
		raw, err := readMessage(in)
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			logger.Println("the browser closed the connection, exiting")
			return nil
		}
		if err != nil {
			return err
		}
		reply := nativeReply{Version: version, Rdfloaded: "0", Downloadjs: "0", Error: "0", Serverstate: "ok"}
		cmd, err := parseCommand(raw)
		switch {
		case err != nil:
			reply.Serverstate, reply.Error = "fail", err.Error()
		case cmd["command"] == "web-server":
			if current != nil {
				current.close()
				current = nil
			}
			addr := cmd["addr"]
			if addr == "" {
				addr = net.JoinHostPort("127.0.0.1", cmd["port"])
			}
			s, err := startServer(addr, cmd["pwd"])
			if err != nil {
				logger.Printf("failed to listen on %s: %v", addr, err)
				reply.Serverstate, reply.Error = "fail", err.Error()
			} else {
				current = s
				reply.Serveraddr = s.addr
			}
		default:
			reply.Serverstate, reply.Error = "fail", fmt.Sprintf("unknown command %q", cmd["command"])
		}
		if err := writeMessage(out, reply); err != nil {
			return err
		}
	}
}

func readMessage(r io.Reader) ([]byte, error) {
	var size uint32
	if err := binary.Read(r, binary.LittleEndian, &size); err != nil {
		return nil, err
	}
	if size == 0 || size > maxMessageSize {
		return nil, fmt.Errorf("invalid message size %d", size)
	}
	buf := make([]byte, size)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func writeMessage(w io.Writer, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	msg := make([]byte, 4, 4+len(b))
	binary.LittleEndian.PutUint32(msg, uint32(len(b)))
	_, err = w.Write(append(msg, b...))
	return err
}

/** the message is a JSON object, or a JSON string holding one (older extensions encoded it twice) */
func parseCommand(raw []byte) (map[string]string, error) {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("invalid message: %v", err)
	}
	if s, ok := v.(string); ok {
		if err := json.Unmarshal([]byte(s), &v); err != nil {
			return map[string]string{"command": s}, nil
		}
	}
	obj, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid message: %s", raw)
	}
	cmd := make(map[string]string, len(obj))
	for k, x := range obj {
		switch x := x.(type) {
		case string:
			cmd[k] = x
		case nil:
		default:
			cmd[k] = fmt.Sprint(x)
		}
	}
	return cmd, nil
}
