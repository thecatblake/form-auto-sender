import client from "prom-client";
import http from "http";

const register = new client.Registry();

client.collectDefaultMetrics({
	register
});

const submissionProcessed = new client.Counter({
  name: "submission_processed_total",
  help: "The number of submissions processed",
});

const submissionProcessDuration = new client.Histogram({
  name: "submission_process_duration_seconds",
  help: "The duration of processing submissions in seconds",
  buckets: [1, 10, 15, 45, 60, 120, 180, 240],
});


register.registerMetric(submissionProcessed);
register.registerMetric(submissionProcessDuration);

export function startMetricsServer(port = 9100) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      try {
        const metrics = await register.metrics();
        res.writeHead(200, {
          "Content-Type": register.contentType,
        });
        res.end(metrics);
      } catch (err) {
        res.writeHead(500);
        res.end((err as Error).message);
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(port, () => {
    console.log(`Metrics server listening on http://localhost:${port}/metrics`);
  });

  return server;
}

export { register, submissionProcessed, submissionProcessDuration };
