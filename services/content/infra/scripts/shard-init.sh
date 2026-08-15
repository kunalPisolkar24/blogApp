#!/bin/sh
# Waits for mongos and both shards, then shards blog_content.posts on a
# hashed _id key: documented-safe for hashed sharding, evenly distributes
# writes, and keeps targeted post(id) lookups fast. Idempotent: a second
# run detects the existing shard key and exits cleanly. Any real failure
# exits non-zero so the job visibly fails instead of silently leaving the
# stack unsharded.
set -eu

URI="mongodb://root:${MONGO_ROOT_PASSWORD}@content-mongo-mongos-0:27017/admin"

echo "waiting for mongos..."
for i in $(seq 1 90); do
  if mongosh "$URI" --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q 1; then
    break
  fi
  sleep 2
done

echo "waiting for shards to register..."
mongosh "$URI" --quiet <<'EOF'
const shardCount = () => {
  const s = db.adminCommand({ listShards: 1 });
  return s.ok ? s.shards.length : 0;
};
let count = 0;
for (let i = 0; i < 90; i++) {
  count = shardCount();
  if (count >= 2) break;
  sleep(2000);
}
if (count < 2) {
  print('expected 2 shards, found ' + count);
  quit(1);
}

sh.enableSharding('blog_content');

const existing = db.getSiblingDB('config').collections.findOne({ _id: 'blog_content.posts' });
if (existing && existing.shardKey) {
  print('blog_content.posts already sharded on ' + JSON.stringify(existing.shardKey));
  quit(0);
}

const res = sh.shardCollection('blog_content.posts', { _id: 'hashed' });
if (!res.ok) {
  print('shardCollection failed: ' + JSON.stringify(res));
  quit(1);
}
print('sharded blog_content.posts on hashed _id');
EOF