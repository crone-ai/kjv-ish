# KJV-ish website

Edit the [root README](../README.md) to change the homepage. The contribution
guide and license notice have their own pages. The site publishes the listed
translation downloads alongside those pages.

The static build uses [markdown-it-py](https://github.com/executablebooks/markdown-it-py)
and the vendored [Simple.css v2.3.7](https://github.com/kevquirk/simple.css/releases/tag/v2.3.7).
The stylesheet's [MIT license](vendor/LICENSE) is included.

```sh
python3 -m venv .site-venv
.site-venv/bin/python -m pip install -r site/requirements.txt
.site-venv/bin/python tools/site.py build
.site-venv/bin/python tools/site.py serve
```

The build writes static files to `.site-build/`. The live site serves the
same generated pages and checks the local checkout for edits every two seconds.
Pull changes into this checkout after merging a PR to show them on the site.

On the hosting Mac, the user login services `com.crone.kjvish.site` and
`com.crone.kjvish.tunnel` run the site at `127.0.0.1:8993` and connect
`kjvish.com` to it. The Cloudflare tunnel configuration and credentials live
in the Mac user’s Cloudflare folder. The site is available while the hosting
Mac is awake and signed in.
