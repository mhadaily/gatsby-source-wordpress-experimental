import url from "url"
import fetchGraphql from "~/utils/fetch-graphql"
import store from "~/store"
import gql from "~/utils/gql"
import { formatLogMessage } from "~/utils/format-log-message"
import { LAST_COMPLETED_SOURCE_TIME, MD5_CACHE_KEY } from "~/constants"

import { createContentDigest } from "gatsby-core-utils"

import {
  clearHardCache,
  getHardCachedData,
  getHardCachedNodes,
  setPersistentCache,
  getPersistentCache,
} from "~/utils/cache"

const checkIfSchemaHasChanged = async (_, pluginOptions) => {
  const state = store.getState()

  const { helpers } = state.gatsbyApi

  let lastCompletedSourceTime = await helpers.cache.get(
    LAST_COMPLETED_SOURCE_TIME
  )

  const activity = helpers.reporter.activityTimer(
    formatLogMessage(`diff schemas`)
  )

  if (pluginOptions.verbose && lastCompletedSourceTime) {
    activity.start()
  }

  const { data } = await fetchGraphql({
    query: gql`
      {
        schemaMd5
        # also get the wpUrl to save on # of requests
        # @todo maybe there's a better place for this
        generalSettings {
          url
        }
      }
    `,
  })

  const {
    schemaMd5,
    generalSettings: { url: wpUrl },
  } = data

  if (url.parse(wpUrl).protocol !== url.parse(pluginOptions.url).protocol) {
    helpers.reporter.log(``)
    helpers.reporter.warn(
      formatLogMessage(`

The Url set in plugin options has a different protocol than the Url saved in WordPress general settings.

options.url: ${pluginOptions.url}
WordPress settings: ${wpUrl}

This may cause subtle bugs, or it may be fine.
Please consider addressing this issue by changing your WordPress settings or plugin options accordingly.

`)
    )
  }

  let cachedSchemaMd5 = await helpers.cache.get(MD5_CACHE_KEY)

  let foundUsableHardCachedData

  if (!cachedSchemaMd5) {
    cachedSchemaMd5 = await getHardCachedData({
      key: MD5_CACHE_KEY,
    })

    foundUsableHardCachedData =
      cachedSchemaMd5 && !!(await getHardCachedNodes())
  }

  await setPersistentCache({ key: MD5_CACHE_KEY, value: schemaMd5 })

  const schemaWasChanged = schemaMd5 !== cachedSchemaMd5

  const pluginOptionsMD5Key = `plugin-options-md5`
  const lastPluginOptionsMD5 = await getPersistentCache({
    key: pluginOptionsMD5Key,
  })

  const pluginOptionsMD5 = createContentDigest(pluginOptions)

  const shouldClearHardCache =
    schemaWasChanged || lastPluginOptionsMD5 !== pluginOptionsMD5

  if (shouldClearHardCache && foundUsableHardCachedData) {
    await clearHardCache()

    foundUsableHardCachedData = false
  }

  await setPersistentCache({
    key: pluginOptionsMD5Key,
    value: pluginOptionsMD5,
  })

  if (
    lastCompletedSourceTime &&
    schemaWasChanged &&
    pluginOptions &&
    pluginOptions.verbose
  ) {
    helpers.reporter.log(``)
    helpers.reporter.warn(
      formatLogMessage(
        `The remote schema has changed since the last build, re-fetching all data`
      )
    )
    helpers.reporter.info(
      formatLogMessage(`Cached schema md5: ${cachedSchemaMd5}`)
    )
    helpers.reporter.info(formatLogMessage(`Remote schema md5: ${schemaMd5}`))
    helpers.reporter.log(``)
  } else if (!lastCompletedSourceTime && pluginOptions.verbose) {
    helpers.reporter.log(``)
    helpers.reporter.info(
      formatLogMessage(
        `\n\n\tThis is either your first build or the cache was cleared.\n\tPlease wait while your WordPress data is synced to your Gatsby cache.\n\n\tMaybe now's a good time to get up and stretch? :D\n`
      )
    )
  }

  // record wether the schema changed so other logic can beware
  // as well as the wpUrl because we need this sometimes :p
  store.dispatch.remoteSchema.setState({
    schemaWasChanged,
    wpUrl,
    foundUsableHardCachedData,
  })

  if (pluginOptions.verbose && lastCompletedSourceTime) {
    activity.end()
  }

  return schemaWasChanged
}

export { checkIfSchemaHasChanged }
