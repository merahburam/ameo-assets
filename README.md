# Ameo Assets Server

Static asset server for Ameo Figma plugin sprites and resources.

## Structure

```
assets/
├── server.js          # Express server
├── package.json       # Dependencies
├── sprite-idle-01.png
├── sprite-idle-02.png
├── sprite-walk-01.png
├── sprite-walk-02.png
├── sprite-dance-01.png
├── sprite-pickup-01.png
├── sprite-sleep-01.png
└── (other assets)
```

## Local Development

```bash
npm install
npm start
# Server runs on http://localhost:3000
# Access assets: http://localhost:3000/sprite-idle-01.png
```

## Railway Deployment

1. Push this `assets/` folder to GitHub as a separate repository
2. Create new Railway project from GitHub repo
3. Railway automatically detects `package.json` and runs `npm start`
4. Add custom domain in Railway dashboard: `ameo-production.up.railway.app`

## Asset URLs

Production:
```
https://ameo-production.up.railway.app/sprite-idle-01.png
https://ameo-production.up.railway.app/sprite-walk-01.png
```

Local:
```
http://localhost:3000/sprite-idle-01.png
http://localhost:3000/sprite-walk-01.png
```
