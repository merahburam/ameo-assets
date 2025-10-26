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
        const feedbackArray = await generateDesignFeedback(frame.frameData);
        // feedbackArray is now an array of feedback items
        feedbackArray.forEach((feedback) => {
          feedbackList.push({
            frameId: frame.frameId,
            feedback: feedback.feedback,
            category: feedback.category,
            confidence: feedback.confidence,
          });
        });
        console.log(`✅ Feedback generated for: "${frame.frameData.name}" (${feedbackArray.length} points)`);
      } catch (frameError) {
        console.error(`❌ Error processing frame ${frame.frameId}:`, frameError.message);
        console.error(`Frame data:`, frame.frameData);
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
    const prompt = `You are Ameo, a friendly UX/UI design expert cat. Analyze this Figma frame and provide detailed feedback on multiple aspects.

Frame: ${frameData.name} (${frameData.width}x${frameData.height}px)
Has colors: ${frameData.fills ? frameData.fills.length > 0 : false}
Has borders: ${frameData.strokes ? frameData.strokes.length > 0 : false}

Provide feedback as a JSON array with 3-4 specific comments about different aspects (layout, spacing, colors, typography, accessibility, etc). Each comment should be 1-2 sentences and friendly.

Respond with ONLY JSON array (no markdown, no extra text):
[
  {
    "feedback": "Comment about layout/spacing",
    "category": "spacing"
  },
  {
    "feedback": "Comment about colors/contrast",
    "category": "color"
  },
  {
    "feedback": "Comment about typography/readability",
    "category": "typography"
  },
  {
    "feedback": "Comment about accessibility",
    "category": "accessibility"
  }
]`;

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
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`DeepSeek API error (${response.status}):`, errorData);
      throw new Error(`DeepSeek API error: ${response.statusText} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("Invalid DeepSeek response structure:", data);
      throw new Error("Invalid response from DeepSeek API");
    }
    const content = data.choices[0].message.content;
    console.log(`📨 DeepSeek response (${content.length} chars):`, content.substring(0, 200));

    // Try to parse as array (multiple feedback points)
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        // Return array of feedback items
        return parsed.map((item) => ({
          feedback: item.feedback || "Nice design!",
          category: item.category || "general",
          confidence: item.confidence || 0.8,
        }));
      }
    }

    // Fallback to single feedback object
    const objMatch = content.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const parsed = JSON.parse(objMatch[0]);
      return [{
        feedback: parsed.feedback || "Nice design!",
        category: parsed.category || "general",
        confidence: parsed.confidence || 0.8,
      }];
    }

    // If no JSON found, return single generic feedback
    return [{
      feedback: content,
      category: "general",
      confidence: 0.75,
    }];
  } catch (error) {
    console.error("DeepSeek error:", error.message);
    return generateSimpleFeedback(frameData);
  }
}

// Simple rule-based feedback (fallback)
function generateSimpleFeedback(frameData) {
  const feedback_list = [
    { feedback: "Great design! Consider testing on different screen sizes.", category: "layout" },
    { feedback: "Nice work! Ensure sufficient contrast for accessibility.", category: "accessibility" },
    { feedback: "Clean layout! Make sure spacing is consistent.", category: "spacing" },
    { feedback: "Good visual design! Consider the user experience on mobile.", category: "responsive" },
  ];

  // Return as array (consistent with API expectations)
  return [
    {
      feedback: feedback_list[Math.floor(Math.random() * feedback_list.length)].feedback,
      category: feedback_list[Math.floor(Math.random() * feedback_list.length)].category,
      confidence: 0.7 + Math.random() * 0.2,
    }
  ];
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
