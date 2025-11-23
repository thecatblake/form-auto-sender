import client from "prom-client";

const register = new client.Registry();

client.collectDefaultMetrics({
	register
})

const submissionCounter = new client.Counter({
	name: "submission total",
	help: "The number of submission accepted",
});

register.registerMetric(submissionCounter);

export { register, submissionCounter };