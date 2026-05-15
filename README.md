# PostForge

A desktop blog editor with a local API server. Write, manage, and publish blog posts with a beautiful dark-themed interface.

## Features

- Dashboard with post grid, filtering (All / Drafts / Published), and search
- Markdown editor with live preview
- Read-only post viewer
- Draft / Publish workflow
- Image upload (hero images + drag-and-drop in editor)
- Tag system with autocomplete
- Multi-environment support (local / production)
- Keyboard shortcuts (Cmd+N, Cmd+S, Cmd+O, Cmd+D)

## Quick Start

```bash
git clone https://github.com/devstefancho/postforge.git
cd postforge
npm install
cp .env.example .env   # Edit API_SECRET_KEY
npm run dev             # Start server at http://localhost:8788
```

### Desktop App

```bash
cd desktop
npm install
npm start               # Launch Electron app (auto-starts server)
```

## Configuration

Edit `.env`:

```env
API_SECRET_KEY=your-secret-key
PORT=8788
DATA_DIR=./data
GEMINI_API_KEY=your-gemini-key   # optional — enables hero auto-generation (ADR-0004)
```

If `GEMINI_API_KEY` is unset, Save still works; the hero auto-generation step is silently disabled and manual hero upload continues to work.

## API

All write endpoints require `Authorization: Bearer <API_SECRET_KEY>` header.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/posts` | No | List posts (query: `category`, `drafts`) |
| POST | `/api/posts` | Yes | Create or update post |
| GET | `/api/posts/:slug` | No | Get single post |
| DELETE | `/api/posts/:slug` | Yes | Delete post and images |
| GET | `/api/posts/tags` | No | List all unique tags |
| POST | `/api/images/upload` | Yes | Upload image (base64) |
| GET | `/api/images/*` | No | Serve uploaded image |

## Tech Stack

- **Server**: Express + better-sqlite3 + local filesystem
- **Desktop**: Electron
- **Database**: SQLite (auto-created in `./data/`)
- **Images**: Stored locally in `./data/images/`

## License

MIT
