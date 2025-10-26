/**
 * Ameo Unified Server
 * Serves:
 * 1. Static assets (sprites)
 * 2. AI feedback via DeepSeek API
 *
 * Deploy to Railway:
 * 1. Set DEEPSEEK_API_KEY environment variable
 * 2. Run: npm install express cors dotenv
 * 3. Run: node server.js
 */

const express = require("express");
const path = require("path");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
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
// AI Feedback API (DeepSeek)
// ============================================

app.post("/api/feedback", async (req, res) => {
  try {
    const { frames } = req.body;

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({
        error: "Missing or invalid frames array",
      });
    }

    console.log(`📝 Processing feedback for ${frames.length} frame(s)`);

    const feedbackList = [];
    for (const frame of frames) {
      try {
        const feedback = await generateDesignFeedback(frame.frameData);
        feedbackList.push({
          frameId: frame.frameId,
          ...feedback,
        });
        console.log(`✅ Feedback generated for: "${frame.frameData.name}"`);
      } catch (frameError) {
        console.error(`❌ Error processing frame ${frame.frameId}:`, frameError.message);
        feedbackList.push({
          frameId: frame.frameId,
          feedback: "Unable to generate feedback at this time",
          category: "general",
          confidence: 0,
        });
      }
    }

    res.json(feedbackList);
  } catch (error) {
    console.error("❌ Error in /api/feedback:", error.message);
    res.status(500).json({
      error: "Failed to generate feedback",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// AI Feedback Implementation (DeepSeek)
// ============================================

async function generateDesignFeedback(frameData) {
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;

  if (!deepseekApiKey) {
    console.warn("DeepSeek API key not configured, using simple feedback");
    return generateSimpleFeedback(frameData);
  }

  try {
    const prompt = `You are Ameo, a friendly UX/UI design expert cat. Analyze this Figma frame and provide brief, actionable feedback.

Frame: ${frameData.name} (${frameData.width}x${frameData.height}px)

Provide 1-2 sentences of friendly feedback. Respond with ONLY JSON:
{
  "feedback": "Your feedback here",
  "category": "layout",
  "confidence": 0.85
}`;

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        feedback: parsed.feedback || "Nice design!",
        category: parsed.category || "general",
        confidence: parsed.confidence || 0.8,
      };
    }

    return {
      feedback: content,
      category: "general",
      confidence: 0.75,
    };
  } catch (error) {
    console.error("DeepSeek error:", error.message);
    return generateSimpleFeedback(frameData);
  }
}

// Simple rule-based feedback (fallback)
function generateSimpleFeedback(frameData) {
  const feedback_list = [
    "Great design! Consider testing on different screen sizes.",
    "Nice work! Ensure sufficient contrast for accessibility.",
    "Clean layout! Make sure spacing is consistent.",
    "Good visual design! Consider the user experience on mobile.",
  ];

  return {
    feedback: feedback_list[Math.floor(Math.random() * feedback_list.length)],
    category: "general",
    confidence: 0.7 + Math.random() * 0.2,
  };
}

// ============================================
// 404 Handler
// ============================================

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path,
    available: ["/health", "/", "POST /api/feedback"],
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
