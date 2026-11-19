# Contributing to KJV-ish

You can challenge a term even if you don't read Hebrew or Greek. Start with the exact verse, what you understood, and a wording that would have helped. A reviewer can then check the original-language evidence.

## Open a pull request

1. Fork the repository and make a branch for one verse or one tightly related wording question. Use a title such as **Clarify “prevent” in 1 Thessalonians 4:15**.
2. Fill in the [pull request template](.github/pull_request_template.md). Include the current wording, a proposed replacement or a case for keeping it, and a short account of the likely misreading or learning value. If you propose a rule across verses, list the affected references and show representative uses and exceptions.
3. Cite evidence at the level of the claim. For a changed English sense, give a historical dictionary, the KJV reading, or a parallel passage. For a claim about meaning in the original, give the Hebrew, Aramaic, or Greek word or phrase, the edition or lexicon, a link to the exact verse or entry, and a sentence explaining how the evidence supports the change. A Strong’s number can make a claim easy to check. The sentence and context still matter.
4. Add a short Markdown proposal under `proposals/` named for the verse and word, such as `1Thess.4.15-prevent.md`, and open the PR. Keep the pinned source and generated TSV intact while the proposal is under review.

## How an edit is accepted

- An editor records the decision and reason in the PR. An acceptance records the approving editor’s handle and the evidence that supports the exact wording. The recorded decision can also keep the original, add a note, or hold the question for more evidence.
- A repeated word is reviewed as a set of uses. A proposed change from *let* to *hinder* needs evidence for each sense before it can apply beyond the passage under discussion. Group uses that share the same sense and give exceptions their own treatment.
- Separate an English clarification from a change in a source reading. If a comparison also adds or drops a clause, changes who acts, or resolves a disputed Hebrew or Greek reading, describe that separately. An editor who can check the original-language evidence reviews that decision before it goes into the text.
- When a wording change is approved, the editor adds the matching record to [`approved-edits.json`](approved-edits.json). Put the editor’s handle in `approvedBy` and keep the rationale and sources with the PR or proposal. The build uses offsets into the pinned AKJV, so a challenge to an existing edit should identify both the current draft wording and the underlying source span.

Find the exact source span without counting characters by hand.

```sh
python3 tools/edition.py span 1Thess.4.15 'prevent' 'precede'
```

The command prints a draft record. It leaves `approvedBy` open for the approving editor. After recording the approval, regenerate and verify the edition, then review the text diff before merging.

```sh
python3 tools/edition.py build
python3 tools/edition.py check
git diff -- approved-edits.json text/kjv-ish.tsv
```

By submitting an original wording or editorial note for inclusion, you agree to offer your contribution under the repository’s [CC BY-SA 4.0 terms](NOTICE.md). Give credit for sources and link to published translations or lexicons. Use brief quotations where needed to make the case.

## Worked example

- **Passage** — 1 Thessalonians 4:15
- **Before and after** — “shall not prevent them” → “shall not precede them”
- **Likely misreading** — Today, *prevent* can suggest that the living will stop the dead from rising.
- **Evidence** — The Greek verb *phthanō* (G5348) concerns going ahead here. Verse 16 explains the sequence by saying the dead in Christ will rise first. [Greek text and English comparison](https://classic.net.bible.org/verse.php?book=1Th&chapter=4&verse=15)
- **Scope** — This proposal replaces one verb in one verse. Review other uses of *prevent* in their own contexts.
