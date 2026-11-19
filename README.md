# KJV-ish

**The Autodidact’s Translation**

We’re fans of the King James Bible. We like its cadence, and we’re happy to learn some of its arcana. An old word can make the passage more memorable and give a curious reader a reason to look something up. That delight wears thin when a form keeps interrupting the reading. A familiar word with a changed meaning poses a different problem. The reader can carry on with a perfectly plausible misunderstanding.

KJV-ish is an English revision in progress. The [verse text](text/kjv-ish.tsv) contains all 66 books and 31,102 verses. The [approved edit ledger](approved-edits.json) is empty at this checkpoint. Workshop choices are evidence for editorial review. An approved ledger entry is what changes the edition.

The [project site at kjvish.com](https://kjvish.com/) is built from this README. See the [site setup](site/README.md) for how to preview it.

## Where we start

Michael Peter (Stone) Engelbrite described the American King James Version as a word-for-word update of the KJV focused on spelling and vocabulary. He kept the grammar because he believed changing it could change the doctrine. He placed the AKJV in the public domain on November 8, 1999. The author's statement and the publisher's current site give the same account. [Engelbrite’s original statement](https://engelbrite.com/inspiredidea.com/home/akj/index.html) · [AKJV publisher](https://akjv.us/)

We start with the publisher’s plain 1999 AKJV export, version `-02`. The [source record](sources/akjv-1999.json) pins the archive, its text member, and its checksum. The earlier update has already handled a great deal of routine KJV wording. We carry that work forward and review the older language that remains, passage by passage. We favor small changes that preserve the line’s meaning and cadence. A proposal that changes the grammar, interpretation, or underlying Hebrew or Greek reading needs its own explanation and review.

## Methodology

1. **Look for a plausible wrong reading.** Ask what a reader would understand on first reading. If their interpretation makes sense in modern English and changes the meaning, prefer a clear replacement. In 1 Peter 3:1, *conversation* can pass for speech. *Conduct* makes the broader sense clear. In Exodus 29:41, *meat offering* can sound like the lamb itself. The preceding verse describes flour mixed with oil, so *grain offering* is clearer.
2. **Keep arcana that earns the look-up.** In 1 Corinthians 10:25, “sold in the shambles” signals a place. Learning that *shambles* meant a meat market adds something to the reading. *I trow not* and *the quick and the dead* are other phrases we favor keeping with a short explanation where readers need one.
3. **Count the friction across the book.** Repetition reduces the value of discovering the same word. A rare form like *haply* can earn its place readily. *Peradventure* needs a closer look where several instances appear together. Routine forms like *doth* and *thou* would add much more friction across a full KJV reading. Preserve a distinction such as singular address when it matters to the passage.
4. **Change the smallest span that solves the problem.** Compare the pinned AKJV with the KJV and read the surrounding verses. Check the Hebrew, Aramaic, or Greek when the meaning depends on it. Another English translation can give us a useful comparison. When it also changes a manuscript reading or makes a different interpretive choice, isolate the English wording question first.
5. **Check the result with readers and record the reason.** Ask a reader what the passage means before explaining the old sense. A correct paraphrase and a preference for the original cadence are different kinds of evidence. Blind Workshop votes and model forecasts help us find decisions worth reviewing. The ledger records the exact change and editor approval.

## Frequency of older wording

We track 95 exact words and phrases drawn from the first AKJV review scan and a few comparison terms. Counts are case-insensitive and include all 31,102 verses of each edition. They count the written form across its senses. For example, the count for *let* includes ordinary permission and the occasional older sense of hindering. Counts help set priorities. The passage decides which sense is present.

| Word or phrase | Plain AKJV | KJV | AKJV concentration |
|---|---:|---:|---|
| shambles | 1 | 1 | 1 Corinthians |
| trow | 1 | 1 | Luke |
| haply | 6 | 6 | Five books, with two in Acts |
| quick | 10 | 10 | Eight books |
| quicken | 13 | 13 | Twelve in Psalms |
| conversation | 20 | 20 | Six in 1 Peter |
| peradventure | 32 | 32 | Sixteen in Genesis |
| divers | 37 | 37 | Eighteen books |
| meat offering | 122 | 122 | Fifty-three in Numbers |
| doth | 0 | 207 | A KJV comparison term |
| thou | 0 | 5,474 | A KJV comparison term |

| AKJV occurrences per tracked form | Tracked forms |
|---|---:|
| 0 | 2 |
| 1 | 30 |
| 2–5 | 33 |
| 6–20 | 19 |
| 21–50 | 5 |
| 51 or more | 6 |

The [frequency catalogue](data/frequency.tsv) includes occurrences, verses, books, and where each form peaks. The [by-book catalogue](data/frequency-by-book.tsv) makes clusters visible. Counts may overlap when one tracked phrase contains another. The KJV comparison uses [Project Gutenberg eBook 10](https://www.gutenberg.org/ebooks/10) with the [source checksum recorded here](sources/kjv-comparison.json).

## Challenge a reading

Open a pull request for one wording question and use the [pull request template](.github/pull_request_template.md). Give the verse, exact before and after wording, the meaning a reader might take from each, and evidence from a source someone else can check. For the full process and a worked example, see [Contributing](CONTRIBUTING.md).

## Rebuild the edition

The generated UTF-8 TSV has two columns, `verse` and `text`. References use OSIS keys such as `Gen.1.1`. The build runs offline with Python 3.10 or later and the checked-in source.

```sh
python3 tools/edition.py build
python3 tools/edition.py check
```

The frequency tables can be rebuilt with the companion KJV Markdown export made from the pinned Gutenberg file. Pass its checkout folder with `python3 tools/edition.py frequency --kjv-markdown /path/to/kjv-markdown`.

The verse TSV is the standalone edition. The HeroMonk Bible checkout can build a SWORD module from this repository’s source archive and edit ledger. Its reader interface, audio library, commentaries, and Workshop votes live in the separate reader workspace.

## License

Original KJV-ish wording and editorial material are licensed under **Creative Commons Attribution-ShareAlike 4.0 International** where copyright applies. See [attribution and scope](NOTICE.md) and the [full license](LICENSE). The underlying AKJV text remains public domain. The [build tools have their own MIT license](tools/LICENSE).
