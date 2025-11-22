import { createClient } from "redis";


(async function () {
	const client = createClient();

	client.on("error", err => console.log("Redis Client Error", err));

	await client.connect();

})();