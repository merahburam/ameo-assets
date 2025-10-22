/**
 * Ameo Assets Server
 * Serves sprites and static assets for the Ameo Figma plugin
 *
 * Deploy to Railway:
 * 1. Push this repo to GitHub (just the assets folder)
 * 2. Create new Railway project from GitHub
 * 3. Railway will auto-detect package.json and npm start
 * 4. Add custom domain: ameo-production.up.railway.app
 */

const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname)));

// ============================================
// Health Check
// ============================================

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================
// List Available Assets
// ============================================

app.get("/", (req, res) => {
  const fs = require("fs");
  const assetsDir = path.join(__dirname);

  try {
    const files = fs.readdirSync(assetsDir).filter((file) => {
      const stat = fs.statSync(path.join(assetsDir, file));
      return stat.isFile() && !file.startsWith(".");
    });

    res.json({ 
      status: "ok",
      assets: files,
      message: "Access files directly: /sprite-idle-01.png, etc."
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to list assets" });
  }
});

// ============================================
// 404 Handler
// ============================================

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path,
    available: ["/health", "/"],
  });
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🐱 Ameo Assets Server Running 🖼️    ║
╚════════════════════════════════════════╝

📍 Server: http://localhost:${PORT}
🏥 Health: http://localhost:${PORT}/health
📦 Assets: http://localhost:${PORT}/

Example asset URLs:
  http://ameo-production.up.railway.app/sprite-idle-01.png
  http://ameo-production.up.railway.app/sprite-walk-01.png
  etc.
`);
});

module.exports = app;
