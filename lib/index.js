const path = require('path')
const { Feed } = require('feed')
const RSS = require('rss')
const { getFeedPath, resolveURL } = require('./utils')

const ID = 'generate-feed'

exports.name = ID

exports.apply = (api, options = {}) => {
  // Plugin options
  options = Object.assign(
    {
      limit: 30,
      generator: 'Saber',
      copyright: 'All rights reserved'
    },
    options
  )

  const { siteConfig } = api.config
  if (!siteConfig.url) {
    throw new Error(`siteConfig.url is required for saber-plugin-feed`)
  }

  const jsonFeedPath = getFeedPath(options.jsonFeed, 'feed.json')
  const atomFeedPath = getFeedPath(options.atomFeed, 'atom.xml')
  const rss2FeedPath = getFeedPath(options.rss2Feed, 'rss2.xml')

  api.hooks.defineVariables.tap(ID, variables => {
    return Object.assign(variables, {
      jsonFeedPath,
      atomFeedPath,
      rss2FeedPath
    })
  })

  api.browserApi.add(path.join(__dirname, 'saber-browser.js'))

  api.hooks.afterGenerate.tapPromise(ID, async () => {
    const allLocalePaths = new Set(
      ['/'].concat(Object.keys(api.config.locales || {}))
    )
    await Promise.all(
      [...allLocalePaths].map(localePath => generateFeed(localePath))
    )
  })

  async function generateFeed(localePath) {
    // Prepare posts
    const posts = []

    await Promise.all(
      [...api.pages.values()].map(async page => {
        if (page.type !== 'post' || page.draft) {
          return
        }

        const matchedLocalePath = api.pages.getMatchedLocalePath(page.permalink)
        if (localePath !== matchedLocalePath) {
          return
        }

        const content = await api.renderer.renderPageContent(page.permalink)
        const item = {
          title: page.title,
          author: siteConfig.author,
          id: resolveURL(siteConfig.url, page.permalink),
          link: resolveURL(siteConfig.url, page.permalink),
          url: resolveURL(siteConfig.url, page.permalink),
          // Strip HTML tags in excerpt and use it as description (a.k.a. summary)
          description:
            page.excerpt && page.excerpt.replace(/<(?:.|\n)*?>/gm, ''),
          content,
          date: page.updatedAt,
          published: page.createdAt,
          enclosure: page.enclosure,
          custom_elements: [{
            'itunes:image': {
              _attr: {
                href: resolveURL(siteConfig.url, page.background)
              }
            }
          }]
        }
        posts.push(item)
      })
    )

    // Order by published
    const items = posts
      .sort((a, b) => {
        return b.published - a.published
      })
      .slice(0, options.limit)

    // Feed instance
    const feedOptions = {
      title: siteConfig.title,
      description: siteConfig.description,
      // image_url: resolveURL(siteConfig.url, siteConfig.itunes.image),
      language: siteConfig.language,
      id: siteConfig.url.replace(/\/?$/, '/'), // Ensure that the id ends with a slash
      site_url: siteConfig.url.replace(/\/?$/, '/'),
      link: siteConfig.url,
      copyright: options.copyright,
      generator: options.generator,
      feedLinks: {
        json: jsonFeedPath && resolveURL(siteConfig.url, jsonFeedPath),
        atom: atomFeedPath && resolveURL(siteConfig.url, atomFeedPath)
      }
    }
    const feed = new Feed({
      ...feedOptions,
      author: {
        name: siteConfig.author,
        email: siteConfig.email,
        link: siteConfig.url
      },
    })
    const rss = new RSS({
      ...feedOptions,
      author: siteConfig.author,
      custom_namespaces: {
        'itunes': 'http://www.itunes.com/dtds/podcast-1.0.dtd'
      },
      custom_elements: [
        { 'itunes:explicit': siteConfig.itunes.explicit },
        { 'itunes:author': siteConfig.author },
        { 'itunes:owner': siteConfig.email },
        { 'itunes:category': { _attr: { text: siteConfig.itunes.category } } },
        {
          'itunes:image': {
            _attr: {
              href: resolveURL(siteConfig.url, siteConfig.itunes.image)
            }
          }
        }
      ]
    })

    // Add posts to feed
    items.forEach(post => {
      feed.addItem(post)
      rss.item({
        ...post,
        enclosure: {
          ...post.enclosure,
          size: post.enclosure && post.enclosure.length
        },
        date: post.published
      })
    })

    const { log } = api
    const { fs } = api.utils

    const outDir = api.resolveOutDir()

    const writeFeed = async (fileName, content) => {
      log.info(`Generating ${fileName}`)
      await fs.outputFile(path.join(outDir, fileName), content, 'utf8')
    }

    await Promise.all([
      jsonFeedPath &&
      writeFeed(path.join('./', localePath, jsonFeedPath), feed.json1()),
      atomFeedPath &&
      writeFeed(path.join('./', localePath, atomFeedPath), feed.atom1()),
      rss2FeedPath &&
      writeFeed(path.join('./', localePath, rss2FeedPath), rss.xml())
    ])
  }
}
