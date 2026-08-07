import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("user schema contract", () => {
  it("includes updateProfile in the user subgraph SDL used by the gateway", () => {
    const schema = readFileSync(
      resolve(process.cwd(), "../services/user/schema.graphql"),
      "utf8",
    );

    expect(schema).toContain("updateProfile");
  });
});

describe("content schema contract", () => {
  it("includes post CRUD and tag queries in the content subgraph SDL", () => {
    const schema = readFileSync(
      resolve(process.cwd(), "../services/content/graph/schema.graphqls"),
      "utf8",
    );

    expect(schema).toContain("createPost");
    expect(schema).toContain("updatePost");
    expect(schema).toContain("deletePost");
    expect(schema).toContain("postsByTag");
    expect(schema).toContain("tags(query: String, limit: Int)");
  });

  it("includes searchPosts and SearchResult in the content subgraph SDL", () => {
    const schema = readFileSync(
      resolve(process.cwd(), "../services/content/graph/schema.graphqls"),
      "utf8",
    );

    expect(schema).toContain("searchPosts(query: String!, page: Int, limit: Int): SearchResult!");
    expect(schema).toContain("type SearchResult");
    expect(schema).toContain("hits: [Post!]!");
    expect(schema).toContain("total: Int!");
  });
});
