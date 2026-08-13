// Tiny shared mutable state object. No pub/sub, no persistence here —
// app.js reads/writes it and is responsible for persisting the fields
// that need to survive a reload (via db.js's meta store, once it exists).
export const state = {
  lang: "nl", // "nl" | "en"
  theme: "auto", // "auto" | "dark" | "light" | "midnight" | "paper"
  density: "comfortable", // "comfortable" | "compact"
  filters: {
    search: "",
    location: { room: "", storage: "", section: "", name: "" },
    category: "",
    itemState: "",
  },
};
