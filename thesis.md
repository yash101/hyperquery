root = 'blog'
name = 'search-context-optimization'
page = 1
title = 'Infinite Context in LLMs for Coding'
subtitle = 'Why brute force?'
isPublished = false

publishedOn = '2025-04-07T16:00:00.277Z'
lastModifiedOn = '2025-04-07T16:00:00.277Z'
authors = 'yash101'

opengraph-image = '/assets/objects/blogs/vectorization/opengraph.png'
Are we misusing LLM context windows? How can we do more with smaller and cheaper models? 

This is a thesis, and something I wish to work on and test in the future. Until then, happy to chat with anyone who wants to work on this.

Are we misusing LLM context windows? How can we do more with smaller and cheaper models?

This is a thesis, and something I wish to work on and test in the future. Until then, I'm happy to chat with anyone who wants to work on this.

## LLM Context: the problem

Most coding agents today, whether Claude Code/CLI, Codex, GitHub copilot, others, grok through your codebase using tools like grep to find patterns. They rely heavily on their own context (read: "short term memory") to understand the codebase and build a picture.

Every new session you have with an LLM, that picture needs to be rebuilt.

That is expensive, very very expensive!

Today, foundational model developers such as OpenAI focus on building models with larger contexts (more short term memory). This is expensive and does not scale up. So my main thought process before writing this article was, how can we augment the context of an LLM such that it can operate with a much smaller context window?

More importantly, this is how *we*, *humans* think. We don't use our short term memory to remember our whole codebase? Hell I sometimes look at a codebase I wrote an year later and ask myself which dumbass wrote this?

## Search

Search engines are hard. The core problem that search engines try to solve is information retreival at web scale. That's a hard problem, but it's also a mostly solved problem. Why can't we use search, a strongly developed and mature field, to augment the capabilities of our LLMs?

## Graphs

Code isn't just a set of documents. It's a graph. How do we know that? The job of `ld` and other linkers is literally to *fix the graph connectivity*.

Most code today:

```
constants
functions
classes
    constants
    functions
    classes
        ... this recurses
```

Additionally, instead of writing all of our code in one file in one function, we break it into multiple functions and split those functions into multiple code files. This literally turns our code into a graph structure.

There are multiple ways to analyze and understand a code graph:

* import graph
* call graph
* inheritance graph
* type reference graph
* dependency graps

## But wait, there's more

Code also tends to have side channels apart from the graph search which we can take advantage of:

* symbol usage frequency
* git churn
* dependency centrality
* test coverage
* runtime traces
* ownership
* recency

## The Hypothesis

**LLMs don't need inifinite context in codebases. They need the *correct* context**.

We can rely on the graph behavior and natural organization of code to efficiently and cheaply provide large context access to LLMs. By doing this, we can allow smaller models to operate at levels similar to larger models without a significant drop in accuracy.

## Why I Believe this?

Currently, the industry is moving towards cramming entire codebases into model context. That doesn't scale. But most importantly, this significantly differs from how humans code. We don't memorize our entire codebases... instead, we search through codebases and build just enough context to solve our current problem.

## Adapting Search

Let's attempt to adapt search to better fit agentic coding.

### PageRank

**PageRank** was a breakthrough in web-scale search. The idea behind PageRank was to rank which articles were important by treating every time that link was seen similar to an academic reference.

PageRank used how often an article was backlinked to not just see if a page contained a keyword, but whether that page is *important, relevant and trusted*.

> **PageRank algorithm**
> $$\text{PR}(A) = \frac{1-d}N + d\sum_{i=1}^n{\frac{\text{PR}(T_i)}{C(T_i)}}$$
> 
> Where
> 
> $\text{PR}(x)$ is the page rank of $x$
> 
> $T_i$ represents the pages linking to page $A$
> 
> $C(T_i)$ represents the total number of outbound links on page $T_i$

### What to Extract from Code

Let's start by cataloging all of the data we can efficiently compute and have at our disposal:

* Code graph
    * Import graph
    * Call graph
    * Inheritance graph / polymorphism graphs
    * Type reference graph (could be just treated as normal code composition)
    * Dependency graph
* Side channels
    * symbol usage frequency: probably a foundational building block in the codebase
    * git churn: high churn mean active development or code functional code which matters
    * dependency centrality: a bloom filter for foundational building blocks
    * test coverage: critical components tend to have better test coverage

Next, we can develop indexing and retrieval algorithms to use these features.

### Feature Extraction

Unlike arbitrary text for search, as if we were building Google, code follows syntax and is intentionally machine readable. Let's take advantage of that.

1. Step 1: determine language
2. Step 2: call a language extractor which works with that language. Prototype:
    * Doxygen for C/C++/most popular languages
    * TypeScript compiler + tsdoc/jsdoc for js-based languages
    * something for openapi and grpc (not sure what, maybe custom, or find something)
    * These two should cover like 90% of code
3. Step 3: extract everything and index.

### Index Format

Note: these need recursive engineering to turn into a well-oiled schema.

```
sf:fully.qualified.code.name -> record for the code // allows for namespace-based autocomplete
sb:name.code.qualified.fully -> record for the code // allows to search from the actual name of the piece of code
rc:record_id -> { code details }    // stores the info for that piece of code so we don't store it twice and feel pain in index update
lr:{rootid}:{filepath}:{lineno} -> record for the code

rt:root-id -> { configuration about the root }
```

```ts
type FQN = string;
type RootId = string; // int would be better and faster

interface code_details {
    fqn: FQN; // fully qualified name

    ref_in: FQN[] | null; // array of fqn of references in
    ref_in_ct: number; // # fqn references in (needed so we can drop the array of references in code referenced *everywhere*)
    ref_out: FQN[]; // fqn array of references out
    
    root_id: RootId; // where this exists (which project / repo / etc. this matters since you need to onboard different dirs of code into the index)
    file: string;
    lineno: number;
}

interface RootConfig {
    id: RootId;
    disk_path: string;
    remote_paths: string[];
}
```

Additionally, to keep this as a simple prototype, instead of building an inverted index for text, we'll index comments and other text in Sqlite3/fts5.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;

CREATE VIRTUAL TABLE text_search USING fts5(
    root_id UNINDEXED,
    file UNINDEXED,
    lineno UNINDEXED,
    text,
    tokenize = 'unicode61 remove_diacritics 2'
);
```

### Searching

Do a text search in `sf:{query}` and `sb:{query}` to query LMDB. This is actually generally fine because we're working with code, and names in code are EXACT.

> **Potential improvement:**
>
> store `sf:...` and `sb...` as `sfn:{normalized sf}` and `sbn:{normalized sb}`:
> * fully lowercase
> * normalize to remove all non-ascii chars

Simultaneously, query the FTS5 table.

### Ranking

Without ranking, we have not built code retrieval. We have built Confluence search, but for code. No one wants that!

Prioritization comes from using heuristics to try to decide what is important and most likely to be what you're looking for. Our goal is to collect as much data from the code as well as *side channel* data to highlight the importance of a result.

Potential ranking algorithm:

```js
function rank(
    searchMatchPct: number, // percentage the search matched
    numLinksIn: number,
    referencesIn: FQN[],
    referencesOut: FQN[],
    maxDepth: number = 6,
) {
    if (maxDepth <= 0) return 0;
    
    return searchMatchPct * 3 +
        numLinksIn * 2 +
        referencesOut.length +
        (Math.sum(
            referencesIn
                ?.map(refIn => resolve(refIn))
                ?.map(res => rank(0, res.ref_in_ct, res.ref_in, res.ref_out, maxDepth - 1)) ?? numLinksIn
        ));
}
```

Note that teh algo above is just an example. Things to be added:
* Decay
* Penalties

### Immediate cascading delete

Note that an alternative could be use a memtable-type blob which can tell the LLM or search algo what changed recently. We won't do it here since seems like reindexing isn't particularly hard.

When code is updated, we need to immediately update the index otherwise our search results will be out of date. This is a hard-ish requirement for LLM usage.

Immediately when a file is changed:

1. Delete all records in Sqlite3/fts5 `WHERE root_id = root_id AND file = filepath`
2. Query LMDB for all records `lr:{rootid}:{filepath}:` and capture a list of all pointers
3. Delete all LMDB records for `lr:{rootid}:{filepath}:*`
4. Visit `rc:{record_id}` for each deleted record, delete that record keeping the FQN
5. Delete `sf:{fqn}` for each FQN we captured
6. Delete `sb:{reversed fqn}` for each FQN we captured
7. Index the file again

## Implementation Notes

* Prototype
* LMDB and FTS5 for DB/search only
* daemon process
    * Indexing
    * File watching
* CLI
    * queries the daemon
    * adds / deletes directories as roots to the daemon
    * communicates with the daemon somehow (maybe unix sockets or smtn like that?)

## How the Implementation Differs from the Original Thesis (written by Codex, edited by me)

The implementation follows the core thesis, but it has already diverged from the first sketch in a few important ways.

First, the implementation is more modular than the original notes. Instead of treating indexing as one big process, Hypercode now has a pipeline:

1. Crawlers find documents.
2. Extractors turn documents into an intermediate representation.
3. Annotators can enrich that IR later.
4. Indexers write the IR into LMDB and SQLite FTS5.
5. The daemon coordinates the whole thing and exposes it to the CLI.

This split matters because code search will not stay limited to code forever. Markdown, notebooks, images, PDFs, generated artifacts, and traces all need somewhere to fit without turning the indexer into a pile of special cases.

Second, records are no longer identified by hashes or by FQN alone. Each record gets a monotonic microsecond timestamp `record_id`. This means records are unique even when two files describe the same logical symbol, and LMDB record scans naturally behave like a recency list.

This became important for C and C++. A header can contain a declaration while a source file contains the implementation. Those should not overwrite each other. The implementation treats them as separate records connected by a duplicate group. Search can prefer the implementation, but still expose the declaration because agents often need both.

Third, the implementation separates record identity from symbol identity:

* `record_id` answers: which concrete indexed occurrence is this?
* `fqn` answers: what logical symbol or document section does this represent?
* `duplicate_group_key` answers: which records appear to represent the same logical thing?

The original thesis implied a simpler one-to-one mapping from FQN to record. That is too small for real code.

Fourth, normalized indexes became first-class. The original thesis listed `sfn` and `sbn` as a potential improvement. The implementation includes them:

* `sf:{fqn}:{record_id}`
* `sb:{reversed_fqn}:{record_id}`
* `sfn:{normalized_fqn}:{record_id}`
* `sbn:{normalized_reversed_fqn}:{record_id}`

These are one-to-many indexes now, because duplicates and overloads are expected.

Fifth, FTS5 indexes more than comments. The original notes focused on comments and text. The implementation indexes:

* comments
* docs
* string literals
* markdown
* notebook markdown cells

That reflects a practical realization: for coding agents, important context often lives in docs, README files, notebook notes, error strings, SQL strings, route strings, config-ish strings, and other text side channels.

Finally, the current implementation includes debug tools much earlier than the thesis suggested. This is not part of the retrieval idea itself, but it is necessary for developing the system. If search quality is the product, then being able to inspect LMDB keys, FTS5 rows, raw records, file records, and index stats is not optional. It is how we learn whether the retrieval machinery is telling the truth.

So the thesis remains the same:

**LLMs do not need infinite context in codebases. They need the correct context.**

But the implementation has made the shape of "correct context" more concrete. It is not just symbols and text. It is records, occurrences, duplicate groups, document structure, source spans, graph links, side-channel text, and enough debug visibility to make the system measurable.
