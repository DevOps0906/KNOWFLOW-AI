// 로컬 전용 임베딩 서버 자리표시자. 실제 임베딩은 task-011에서 붙는다.
import http from "node:http";

const server = http.createServer((req, res) => {
  const ok = req.method === "GET" && req.url === "/health";
  res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok }));
});
server.listen(8080, "0.0.0.0");
process.on("SIGTERM", () => process.exit(0));
