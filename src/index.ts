import express from "express";
import bodyParser from "body-parser";
import { router } from "./routes";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use("/api", router);

app.listen(PORT, () => {
  console.log(`🚀 API server running at http://localhost:${PORT}`);
});