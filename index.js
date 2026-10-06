const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { createClient } = require('redis');

const app = express();
app.use(express.json());

const prisma = new PrismaClient();
const redisClient = createClient({ url: 'redis://localhost:6379' });

redisClient.on('error', (err) => console.error('Redis Client Error', err));

async function startServer() {
  await redisClient.connect();
  console.log('Connected to Redis');

  // กิจกรรมที่ 2 & 3: บันทึกลง Postgres และอัปเดตทับใน Redis
  app.post('/api/telemetry', async (req, res) => {
    try {
      const { device_id, voltage, current } = req.body;

      // 1. บันทึกลง Postgres
      const record = await prisma.telemetry.create({
        data: {
          device_id,
          voltage: parseFloat(voltage),
          current: parseFloat(current),
        },
      });

      // 2. อัปเดตทับใน Redis (Key: device:{device id}:latest_status)
      const cacheKey = `device:${device_id}:latest_status`;
      await redisClient.set(cacheKey, JSON.stringify(record));

      return res.status(201).json({ success: true, data: record });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // กิจกรรมที่ 3: Cache Aside Pattern สำหรับ Remote Monitor
  app.get('/api/devices/:id/status', async (req, res) => {
    try {
      const deviceId = req.params.id;
      const cacheKey = `device:${deviceId}:latest_status`;

      // เช็คข้อมูลใน Redis ก่อน (Cache Hit)
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return res.json({ source: 'cache', data: JSON.parse(cachedData) });
      }

      // ถ้าไม่เจอ (Cache Miss) ดึงจาก Postgres
      const record = await prisma.telemetry.findFirst({
        where: { device_id: deviceId },
        orderBy: { timestamp: 'desc' },
      });

      if (!record) {
        return res.status(404).json({ error: 'Device not found' });
      }

      // เซฟกลับเข้า Redis เพื่อรอบถัดไป
      await redisClient.set(cacheKey, JSON.stringify(record));

      return res.json({ source: 'database', data: record });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.listen(3000, () => {
    console.log('Server is running on port 3000');
  });
}

startServer();