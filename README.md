# Toptable

A small virtual tabletop. One Node process serves the page, stores the room, and relays the live table. The table itself is a canvas. There is no React.

## Run locally

Node 22 or newer.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. Create a room, save the DM key, and share the room code.

```bash
npm test
npm run check
```

## Docker

```bash
docker compose up --build
```

The app listens on port 8080. Room files and the database stay in the `toptable-data` volume.
