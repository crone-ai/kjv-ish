# KJV-ish website

The homepage serves the Bible reader. Edit the root README for the About page
at `/about/`. The contribution guide, license notice, and translation downloads
have their own links.

The static build uses [markdown-it-py](https://github.com/executablebooks/markdown-it-py)
and [Simple.css v2.3.7](https://github.com/kevquirk/simple.css/releases/tag/v2.3.7).
The stylesheet's [MIT license](vendor/LICENSE) is included.

```sh
python3 -m venv .site-venv
.site-venv/bin/python -m pip install -r site/requirements.txt
.site-venv/bin/python tools/site.py build
.site-venv/bin/python tools/site.py serve
```

The static build writes to `.site-build/`. Live reading also needs a running
STEP engine. To prepare the public library from a built local STEP checkout,
run the following commands with its absolute path.

```sh
python3 tools/step_reader.py prepare --step-checkout /path/to/step-checkout
python3 tools/step_reader.py serve --step-checkout /path/to/step-checkout
```

Prepare the KJV-ish module against this checkout's approved edit ledger before
updating the installed edition. Build its search index on the loopback STEP
setup API after changing the module. The public site permits only the reader's
read requests and the modules listed in `reader/library.json`. STEP's
installation and administration routes are available only on loopback.

The hosting Mac uses login services for the STEP process, website, and
Cloudflare tunnel. The public site listens at `127.0.0.1:8993` and STEP at
`127.0.0.1:8994`. The site is available while the Mac is awake and signed in.

## Pronunciation delivery

The site requests a single clip when someone clicks a word. The website
issues a 45-second Bunny link for that clip. Visitors can play clips without an
account. The site permits 24 requests per minute, 120 per ten minutes, and 450
per day for an IP address or IPv6 network. Bunny limits bursts and caps total
audio delivery to 100 GB per month. These limits apply to audio. Reading and
translation downloads use separate routes.

The local serving copy is the CDN origin. The origin requires a Bunny-only
request header. Both delivery keys belong in the hosting Mac's private
configuration, with file access limited to the hosting user. Keep the
recordings and full playback indexes outside the public checkout, static
build, and GitHub release archives. A backup is a separate private archive in
Google Cloud Storage with a SHA-256 checksum.
