import mongoose from 'mongoose';

/**
 * Serverless connection reuse. Every Vercel invocation may hit a warm container,
 * and creating a fresh pool per request exhausts Atlas connection limits fast.
 * Caching the promise (not just the connection) also collapses concurrent
 * cold-start requests into a single handshake.
 */
let cached = globalThis.__jobfillMongoose;
if (!cached) cached = globalThis.__jobfillMongoose = { conn: null, promise: null };

export async function connectDB() {
  // A cached connection can go stale. Vercel freezes the container between
  // invocations and Atlas will drop an idle socket; the cached object survives but
  // the connection underneath is dead. Because `bufferCommands` is false, the next
  // query then throws "Client must be connected" instantly — which surfaces as an
  // opaque 500 rather than a connection error. Check readyState before trusting it.
  // 1 = connected, 2 = connecting.
  if (cached.conn?.readyState === 1) return cached.conn;

  if (cached.conn && cached.conn.readyState !== 2) {
    cached.conn = null;
    cached.promise = null;
  }

  if (!cached.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');

    mongoose.set('strictQuery', true);
    cached.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 20000,
      })
      .then((m) => m.connection);
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }
  return cached.conn;
}
