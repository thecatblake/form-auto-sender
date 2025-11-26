import http from "k6/http";

export const options = {
	vus: 1,
	iterations: 200,
};

export default function () {
	const url = "http://35.78.205.169:3000/submit";

	const payload = JSON.stringify({
		"profile_id": "e2f936bb-f38f-436f-af21-d75bdf76bc4e",
		"url": "https://stream-data.co.jp"
	});

	const headers = {
		"Content-Type": "application/json",
	};

	const res = http.post(url, payload, { headers });

	console.log("status:", res.status);
}
