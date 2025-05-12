import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
dotenv.config();

const app: Express = express();
const PORT: number = parseInt(process.env.PORT || "8000", 10);
app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  const timestamp = new Date().toISOString();
  res.status(200).json({
    message: 'OK - Consumer Ready !',
    timestamp: timestamp
  });
});

app.listen(PORT, () => {
  console.log(`TypeScript health check service listening on port ${PORT}`);
});