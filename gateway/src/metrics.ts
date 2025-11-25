import client from "prom-client";

const register = new client.Registry();

client.collectDefaultMetrics({
	register
});

const submissionCounter = new client.Counter({
	name: "submission_total",
	help: "The number of submission accepted",
});

const discoverDuration = new client.Histogram({
	name: "discover_request_duration",
	help: "The duration of the contact discover api request",
	buckets: [0.1, 0.5, 1, 5, 10, 15]
});

register.registerMetric(submissionCounter);
register.registerMetric(discoverDuration);

export { register, submissionCounter, discoverDuration };