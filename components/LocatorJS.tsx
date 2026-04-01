"use client";

import { useEffect } from "react";

export default function LocatorJS() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      import("@locator/runtime").then((mod) => {
        mod.setup({ adapter: "jsx" });
      });
    }
  }, []);

  return null;
}
