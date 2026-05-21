# Benchmarks

`hypercode-bench` runs labeled retrieval cases against a root.

Benchmark files contain:

```json
{
  "root": "/path/to/repo",
  "cases": [
    {
      "query": "where is Authorization set",
      "expected_fqns": ["src/auth.ts#buildAuthorizationHeader"]
    }
  ]
}
```

The current harness reports top-10 hit rate. The intended comparison set is:

- Grep or name-only baseline
- FTS-only baseline
- Hypercode symbolic ranking

Good benchmark queries should be task-shaped, not just exact symbol names.
