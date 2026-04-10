# Portfolio MVP

A minimal portfolio management app with public display and admin editing.

## Quick Start

### Backend
```bash
cd server
npm install
npm run dev
```

### Frontend
```bash
cd client
npm install
npm run dev
```

## URLs
- Public: http://localhost:5173/
- Admin: http://localhost:5173/MP_ADMIN_RESTRICTION

## Database
- Uses MongoDB Atlas for persistence
- Falls back to sample data if DB unavailable
- Configure connection in `server/.env`

## Features
- ✅ Public portfolio display
- ✅ Admin panel for updates
- ✅ Image upload support
- ✅ Mobile-responsive UI
- ✅ Dark theme