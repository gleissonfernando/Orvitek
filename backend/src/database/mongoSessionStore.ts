import session from "express-session";
import type { Collection } from "mongodb";
import { env } from "../config/env";
import { getMongoDb } from "./mongo";

type MongoSessionDocument = {
  _id: string;
  data: session.SessionData;
  createdAt: Date;
  expiresAt: Date;
  updatedAt: Date;
};

let indexPromise: Promise<string> | null = null;

export class MongoSessionStore extends session.Store {
  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    this.collection()
      .then((collection) => collection.findOne({ _id: sid }))
      .then((document) => {
        if (!document) {
          callback(null, null);
          return;
        }

        if (document.expiresAt.getTime() <= Date.now()) {
          this.destroy(sid, () => undefined);
          callback(null, null);
          return;
        }

        callback(null, document.data);
      })
      .catch(callback);
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void {
    const now = new Date();
    const expiresAt = this.expiresAt(sessionData);

    this.collection()
      .then((collection) => collection.updateOne(
        { _id: sid },
        {
          $set: {
            data: sessionData,
            expiresAt,
            updatedAt: now
          },
          $setOnInsert: {
            _id: sid,
            createdAt: now
          }
        },
        { upsert: true }
      ))
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    this.collection()
      .then((collection) => collection.deleteOne({ _id: sid }))
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  touch(sid: string, sessionData: session.SessionData, callback?: () => void): void {
    this.collection()
      .then((collection) => collection.updateOne(
        { _id: sid },
        {
          $set: {
            expiresAt: this.expiresAt(sessionData),
            updatedAt: new Date()
          }
        }
      ))
      .then(() => callback?.())
      .catch(() => callback?.());
  }

  private async collection(): Promise<Collection<MongoSessionDocument>> {
    const db = await getMongoDb();
    const collection = db.collection<MongoSessionDocument>("dashboard_sessions");

    indexPromise ??= collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await indexPromise;

    return collection;
  }

  private expiresAt(sessionData: session.SessionData) {
    const expires = sessionData.cookie.expires;

    if (expires) {
      return new Date(expires);
    }

    return new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);
  }
}
