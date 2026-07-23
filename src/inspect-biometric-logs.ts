import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  try {
    const res = await client.query('SELECT * FROM "BiometricRawLog" ORDER BY "receivedAt" DESC LIMIT 100;');
    console.log('Biometric Raw Logs:');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
