/**
 * Ameo Unified Server
 * Serves:
 * 1. Static assets (sprites)
 * 2. AI feedback via DeepSeek API
 * 3. Messaging system via PostgreSQL
 *
 * Deploy to Railway:
 * 1. Set DEEPSEEK_API_KEY environment variable
 * 2. Set DATABASE_URL for PostgreSQL
 * 3. Run: npm install express cors dotenv pg
 * 4. Run: node server.js
 */

const express = require("express");
const path = require("path");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

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

    console.log(`Processing feedback for ${frames.length} frame(s)`);

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
        console.log(`Feedback generated for: "${frame.frameData.name}" (${feedbackArray.length} points)`);
      } catch (frameError) {
        console.error(`Error processing frame ${frame.frameId}:`, frameError.message);
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
    console.error("Feedback API error:", error.message);
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
    // Build prompt with SVG visual context if available
    let prompt = `You are Ameo, a friendly UX/UI design expert cat. Analyze this Figma frame and provide detailed, specific feedback based on the visual design.

Frame: ${frameData.name} (${frameData.width}x${frameData.height}px)
Has colors: ${frameData.fills ? frameData.fills.length > 0 : false}
Has borders: ${frameData.strokes ? frameData.strokes.length > 0 : false}`;

    // Check if frame is empty
    const isEmpty = !frameData.fills || frameData.fills.length === 0;

    if (frameData.svgBase64) {
      // Check if it's a frame content descriptor or SVG
      if (frameData.svgBase64.startsWith("FRAME_CONTENT:")) {
        // Decode and use frame content description
        try {
          const decoded = Buffer.from(frameData.svgBase64, "base64").toString("utf-8");
          const contentDesc = decoded.replace("FRAME_CONTENT:", "");
          prompt += `

FRAME STRUCTURE & CONTENT:
${contentDesc}

Analyze the frame content and structure above. Provide feedback on:
1. Layout and organization of elements
2. Content hierarchy and visual balance
3. Spacing and alignment consistency
4. Typography and text hierarchy (if applicable)
5. Suggestions for improvement`;
        } catch (e) {
          // Fallback if decode fails
          prompt += `

Frame content description available. Analyzing...`;
        }
      } else if (frameData.svgBase64.startsWith("iVBORw0KGgo")) {
        // PNG format (base64 PNG always starts with iVBORw0KGgo)
        prompt += `

VISUAL DESIGN (PNG Screenshot):
data:image/png;base64,${frameData.svgBase64}

Analyze the PNG screenshot of the frame above and provide detailed feedback on:
1. Visual layout and composition of elements
2. Spacing and alignment between elements
3. Color usage, contrast, and visual hierarchy
4. Typography and text readability
5. Design quality and specific improvement opportunities`;
      } else {
        // SVG or other format
        prompt += `

VISUAL DESIGN (SVG):
data:image/svg+xml;base64,${frameData.svgBase64}

Analyze the SVG visual representation above and provide feedback on:
1. Visual layout and composition
2. Spacing and alignment
3. Color usage and contrast (if applicable)
4. Visual hierarchy and visual balance
5. Any design inconsistencies or improvement opportunities`;
      }
    } else if (isEmpty) {
      prompt += `

NOTE: This frame appears to be empty or blank. Provide feedback on:
1. Suggested purpose for this frame
2. What type of content could work well here
3. Recommended dimensions and structure
4. Design considerations for this frame's intended use`;
    } else {
      prompt += `

Analyze the frame based on metadata and provide feedback on design aspects.`;
    }

    prompt += `

Provide feedback as a JSON array with 3-4 specific, actionable comments. Each comment should be 1-2 sentences and friendly.

Respond with ONLY JSON array (no markdown, no extra text):
[
  {
    "feedback": "Specific feedback about what you observe",
    "category": "category_name"
  }
]

Use these categories as appropriate: layout, spacing, color, typography, accessibility, general`;

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
    console.log(`DeepSeek response (${content.length} chars)`);

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
// Database Initialization
// ============================================

async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        cat_name VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create conversations table
    // Drop if exists with bad schema
    try {
      await pool.query(`DROP TABLE IF EXISTS conversations CASCADE;`);
    } catch (e) {
      // Ignore if table doesn't exist
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Database tables initialized successfully");
  } catch (error) {
    console.error("Database initialization error:", error.message);
  }
}

// ============================================
// Messaging API Endpoints
// ============================================

// Register or get user by cat name
app.post("/api/messages/register", async (req, res) => {
  try {
    const { cat_name } = req.body;

    if (!cat_name || cat_name.trim().length === 0) {
      return res.status(400).json({ error: "Cat name is required" });
    }

    // Check if user already exists
    let result = await pool.query("SELECT id FROM users WHERE cat_name = $1", [cat_name]);

    if (result.rows.length > 0) {
      return res.json({ id: result.rows[0].id, cat_name, created: false });
    }

    // Create new user
    result = await pool.query(
      "INSERT INTO users (cat_name) VALUES ($1) RETURNING id, cat_name, created_at",
      [cat_name]
    );

    res.json({ id: result.rows[0].id, cat_name: result.rows[0].cat_name, created: true });
  } catch (error) {
    console.error("Register error:", error.message);
    res.status(500).json({ error: "Failed to register user" });
  }
});

// IMPORTANT: Specific routes MUST come before generic routes with same parameter count
// Otherwise /api/messages/unread/:name will match /:user/:other pattern

// Check if cat name exists
app.get("/api/messages/check-name/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const result = await pool.query("SELECT id FROM users WHERE cat_name = $1", [name]);
    res.json({ exists: result.rows.length > 0, id: result.rows[0]?.id || null });
  } catch (error) {
    console.error("Check name error:", error.message);
    res.status(500).json({ error: "Failed to check cat name" });
  }
});

// Get all conversations for a user (must come before :user/:other pattern)
app.get("/api/messages/list/:user_cat_name", async (req, res) => {
  try {
    const { user_cat_name } = req.params;

    const userResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      user_cat_name,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    // Get all conversations with latest message
    const convResult = await pool.query(
      `SELECT
        c.id,
        CASE
          WHEN c.user1_id = $1 THEN u2.cat_name
          ELSE u1.cat_name
        END as other_cat_name,
        CASE
          WHEN c.user1_id = $1 THEN c.user2_id
          ELSE c.user1_id
        END as other_user_id,
        (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
        (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
        COALESCE((SELECT COUNT(*)::INTEGER FROM messages m WHERE m.conversation_id = c.id AND m.is_read = FALSE AND m.sender_id != $1), 0) as unread_count
       FROM conversations c
       JOIN users u1 ON c.user1_id = u1.id
       JOIN users u2 ON c.user2_id = u2.id
       WHERE c.user1_id = $1 OR c.user2_id = $1
       ORDER BY last_message_time DESC NULLS LAST`,
      [userId]
    );

    res.json({ conversations: convResult.rows });
  } catch (error) {
    console.error("Get conversations error:", error.message);
    res.status(500).json({ error: "Failed to get conversations" });
  }
});

// Get unread count (must come before :user/:other pattern)
app.get("/api/messages/unread/:user_cat_name", async (req, res) => {
  try {
    const { user_cat_name } = req.params;

    const userResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      user_cat_name,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    const result = await pool.query(
      `SELECT COUNT(*) as unread_count
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE (c.user1_id = $1 OR c.user2_id = $1)
       AND m.sender_id != $1
       AND m.is_read = FALSE`,
      [userId]
    );

    res.json({ unread_count: parseInt(result.rows[0].unread_count) });
  } catch (error) {
    console.error("Get unread count error:", error.message);
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

// Send a message
app.post("/api/messages/send", async (req, res) => {
  try {
    const { sender_cat_name, recipient_cat_name, content } = req.body;

    if (!sender_cat_name || !recipient_cat_name || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get user IDs
    const senderResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      sender_cat_name,
    ]);
    const recipientResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      recipient_cat_name,
    ]);

    if (senderResult.rows.length === 0 || recipientResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const senderId = senderResult.rows[0].id;
    const recipientId = recipientResult.rows[0].id;

    // Get or create conversation
    let convResult = await pool.query(
      `SELECT id FROM conversations
       WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
      [senderId, recipientId]
    );

    let conversationId;
    if (convResult.rows.length === 0) {
      convResult = await pool.query(
        "INSERT INTO conversations (user1_id, user2_id) VALUES ($1, $2) RETURNING id",
        [senderId, recipientId]
      );
      conversationId = convResult.rows[0].id;
    } else {
      conversationId = convResult.rows[0].id;
    }

    // Insert message
    const msgResult = await pool.query(
      "INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, created_at",
      [conversationId, senderId, content]
    );

    res.json({ id: msgResult.rows[0].id, created_at: msgResult.rows[0].created_at });
  } catch (error) {
    console.error("Send message error:", error.message);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Get conversation with a specific user
app.get("/api/messages/:user_cat_name/:other_cat_name", async (req, res) => {
  try {
    const { user_cat_name, other_cat_name } = req.params;

    // Get user IDs
    const userResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      user_cat_name,
    ]);
    const otherResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      other_cat_name,
    ]);

    if (userResult.rows.length === 0 || otherResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;
    const otherId = otherResult.rows[0].id;

    // Get conversation
    const convResult = await pool.query(
      `SELECT id FROM conversations
       WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
      [userId, otherId]
    );

    if (convResult.rows.length === 0) {
      return res.json({ messages: [], otherUserInfo: { cat_name: other_cat_name, id: otherId } });
    }

    const conversationId = convResult.rows[0].id;

    // Get all messages and mark as read
    const msgResult = await pool.query(
      `SELECT m.id, m.content, m.sender_id, m.created_at, u.cat_name
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    // Mark unread messages as read
    await pool.query(
      "UPDATE messages SET is_read = TRUE WHERE conversation_id = $1 AND sender_id = $2",
      [conversationId, otherId]
    );

    res.json({
      messages: msgResult.rows,
      otherUserInfo: { cat_name: other_cat_name, id: otherId },
    });
  } catch (error) {
    console.error("Get conversation error:", error.message);
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

// ============================================
// 404 Handler
// ============================================

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path,
    available: ["/health", "/", "POST /api/feedback", "POST /api/messages/register", "GET /api/messages/list/:cat_name"],
  });
});

// ============================================
// Start Server
// ============================================

async function startServer() {
  // Initialize database if DATABASE_URL is configured
  if (process.env.DATABASE_URL) {
    await initializeDatabase();
  } else {
    console.warn("DATABASE_URL not set - messaging features will not work");
  }

  app.listen(PORT, () => {
    console.log(`Ameo Assets Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

module.exports = app;
