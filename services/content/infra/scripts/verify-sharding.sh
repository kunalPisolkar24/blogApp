#!/bin/sh
# Verifies the HA MongoDB sharding setup: mongos reachable, posts sharded
# on a hashed _id key, chunks spread over both shards, and (by design) no
# unique slug index on the sharded collection (slug uniqueness is enforced
# in-app there). Exits non-zero on any failure.
#
# Run from the host with:
#   make verify-sharding   # requires MONGO_ROOT_PASSWORD, runs on the compose network
set -eu

URI="mongodb://root:${MONGO_ROOT_PASSWORD}@content-mongo-mongos-0:27017/admin"

echo "checking mongos..."
if ! mongosh "$URI" --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q 1; then
  echo "FAIL: mongos is not reachable"
  exit 1
fi

mongosh "$URI" --quiet <<'EOF'
const failures = [];

const posts = db.getSiblingDB('config').collections.findOne({ _id: 'blog_content.posts' });
if (!posts || !posts.shardKey) {
  failures.push('posts is not sharded');
} else {
  const key = JSON.stringify(posts.shardKey);
  if (key !== '{"_id":"hashed"}') {
    failures.push('posts shard key is ' + key + ', expected {"_id":"hashed"}');
  } else {
    print('posts sharded on hashed _id');
  }
}

const chunks = db.getSiblingDB('config').chunks.aggregate([
  { $match: { ns: 'blog_content.posts' } },
  { $group: { _id: '$shard', count: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]).toArray();
if (chunks.length < 2) {
  failures.push('chunks are not spread over both shards: ' + JSON.stringify(chunks));
} else {
  print('chunk distribution: ' + chunks.map(c => c._id + '=' + c.count).join(', '));
}

const slugIndex = db.getSiblingDB('blog_content').posts.getIndexes().find(i => i.name === 'slug_unique');
if (slugIndex) {
  failures.push('slug_unique must not exist on the sharded collection; uniqueness is enforced in-app');
} else {
  print('slug_unique index absent as designed (uniqueness enforced in-app)');
}

if (failures.length > 0) {
  print('FAIL:\n - ' + failures.join('\n - '));
  quit(1);
}
print('sharding verified');
EOF