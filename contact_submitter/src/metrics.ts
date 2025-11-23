import client from "prom-client";

const register = new client.Registry();

client.collectDefaultMetrics({
	register
});

const submissionProcessed = new client.Counter({
	name: "submission processed total",
	help: "The number of submission processed",
});

const submissionProcessDuration = new client.Histogram({
	name: "submission process duration",
	help: "The duration of processing submission",
	buckets: [1, 10, 15, 45, 60, 120, 180, 240]
});

register.registerMetric(submissionProcessed);
register.registerMetric(submissionProcessDuration);

export { register, submissionProcessed, submissionProcessDuration };
