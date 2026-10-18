#!/usr/bin/env python3
"""Minimal static file server with HTTP Range support (stdlib only).

Needed because CheerpJ lazily loads Java classes from jars via Range requests.
Usage: python3 serve.py [port] [root]
"""
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class RangeHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        try:
            fs = os.fstat(f.fileno())
            size = fs.st_size
            range_header = self.headers.get("Range")
            m = None
            if range_header:
                m = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())

            if m and (m.group(1) or m.group(2)):
                start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2)))
                end = int(m.group(2)) if m.group(2) else size - 1
                end = min(end, size - 1)
                if start > end or start >= size:
                    f.close()
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */%d" % size)
                    self.end_headers()
                    return None
                length = end - start + 1
                f.seek(start)
                self.send_response(206)
                self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
            else:
                length = size
                self.send_response(200)

            ctype = self.guess_type(path)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self._range_remaining = length
            return f
        except Exception:
            f.close()
            raise

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "_range_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    os.chdir(root)
    server = ThreadingHTTPServer(("0.0.0.0", port), RangeHandler)
    print("serving %s on http://localhost:%d (Range capable)" % (root, port))
    server.serve_forever()


if __name__ == "__main__":
    main()
