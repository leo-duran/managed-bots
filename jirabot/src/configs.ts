import Bot from 'keybase-bot'
import {BotConfig} from './bot-config'
import * as Errors from './errors'
import * as ChatTypes from 'keybase-bot/lib/types/chat1'

// namespace: jirabot-v1-team-[teamname]; key: jiraConfig
export type TeamJiraConfig = Readonly<{
  jiraHost: string
  jiraAuth: Readonly<{
    consumerKey: string
    publicKey: string
    privateKey: string
  }>
}>

// namespace: jirabot-v1-team-[teamname]; key: user-[keybase username]
export type TeamUserConfig = Readonly<{
  jiraAccountID: string
  accessToken: string
  tokenSecret: string
}>

// namespace: jirabot-v1-team-[teamname]; key: channel-[conversationId]
export type TeamChannelConfig = Readonly<{
  defaultNewIssueProject?: string
}>

export const emptyTeamChannelConfig: TeamChannelConfig = {
  defaultNewIssueProject: undefined,
}

export type TeamJiraSubscription = {
  conversationId: string
  webhookURI: string // needed for unsubscribing
  urlToken: string
  jql: string
  withUpdates: boolean
}

export type TeamJiraSubscriptions = Readonly<
  Map<
    number, // subscription ID that has nothing to do with webhookId
    TeamJiraSubscription
  >
>

// this is the value. key is urlToken
export type JiraSubscriptionIndex = Readonly<{
  teamname: string
  id: number
}>

const getNamespace = (teamname: string): string => `jirabot-v1-team-${teamname}`
const jiraSubscriptionIndexNamespace = 'jirabot-v1-subscription-index'
const jiraConfigKey = 'jiraConfig'
const getTeamUserConfigKey = (username: string) => `user-${username}`
const getTeamChannelConfigKey = (conversationId: ChatTypes.ConvIDStr) =>
  `channel-${conversationId}`
const jiraSubscriptionsKey = 'jiraSubscriptions'

const jsonToTeamJiraConfig = (
  objectFromJson: any
): TeamJiraConfig | undefined => {
  if (
    typeof objectFromJson.jiraHost !== 'string' ||
    !objectFromJson.jiraAuth ||
    typeof objectFromJson.jiraAuth.consumerKey !== 'string' ||
    typeof objectFromJson.jiraAuth.publicKey !== 'string' ||
    typeof objectFromJson.jiraAuth.privateKey !== 'string'
  ) {
    return undefined
  }
  return {
    jiraHost: objectFromJson.jiraHost,
    jiraAuth: {
      consumerKey: objectFromJson.jiraAuth.consumerKey,
      publicKey: objectFromJson.jiraAuth.publicKey,
      privateKey: objectFromJson.jiraAuth.privateKey,
    },
  } as TeamJiraConfig
}

const jsonToTeamUserConfig = (
  objectFromJson: any
): TeamUserConfig | undefined => {
  const {jiraAccountID, accessToken, tokenSecret} = objectFromJson
  if (
    typeof jiraAccountID !== 'string' ||
    typeof accessToken !== 'string' ||
    typeof tokenSecret !== 'string'
  ) {
    return undefined
  }
  return {
    jiraAccountID,
    accessToken,
    tokenSecret,
  } as TeamUserConfig
}

const jsonToTeamChannelConfig = (
  objectFromJson: any
): TeamChannelConfig | undefined => {
  const {defaultNewIssueProject} = objectFromJson
  if (
    typeof defaultNewIssueProject !== 'undefined' &&
    typeof defaultNewIssueProject !== 'string'
  ) {
    return undefined
  }
  return {
    defaultNewIssueProject,
  } as TeamChannelConfig
}

const jsonToTeamJiraSubscriptions = (
  objectFromJson: any
): TeamJiraSubscriptions | undefined => {
  if (!Array.isArray(objectFromJson)) {
    return undefined
  }
  const subscriptions = new Map<number, TeamJiraSubscription>()
  objectFromJson.forEach(([key, value]) => {
    if (
      typeof key !== 'number' ||
      typeof value !== 'object' ||
      typeof value.conversationId !== 'string' ||
      typeof value.webhookURI !== 'string' ||
      typeof value.urlToken !== 'string' ||
      typeof value.jql !== 'string' ||
      !['boolean', 'undefined'].includes(typeof value.withUpdates)
    ) {
      return
    }
    subscriptions.set(key, {
      conversationId: value.conversationId,
      webhookURI: value.webhookURI,
      urlToken: value.urlToken,
      jql: value.jql,
      withUpdates: !!value.withUpdates,
    })
  })
  return subscriptions
}

const jsonToJiraSubscriptionIndex = (
  objectFromJson: any
): JiraSubscriptionIndex | undefined => {
  const {teamname, id} = objectFromJson
  if (typeof teamname !== 'string' || typeof id !== 'number') {
    return undefined
  }
  return {
    teamname,
    id,
  } as JiraSubscriptionIndex
}

const teamJiraSubscriptionsToJson = (
  teamJiraSubscriptions: TeamJiraSubscriptions
): string => JSON.stringify([...teamJiraSubscriptions.entries()])

export type CachedConfig<T> = Readonly<{
  _revision: number
  _timestamp: number
  config: T
}>

type ConfigCache<T> = Map<string, CachedConfig<T>>

const cacheTimeout = 1000 * 60 // 1min
const cachedConfigExpired = <T>(cc?: CachedConfig<T>) =>
  !cc || Date.now() - cc._timestamp > cacheTimeout

const getCacheKey = (namespace: string, entryKey: string) =>
  `${namespace}:${entryKey}`

export default class Configs {
  // TODO: purge cache if RAM consumption is too high
  private cache = {
    teamJiraConfigs: new Map<string, CachedConfig<TeamJiraConfig>>(),
    teamUserConfigs: new Map<string, CachedConfig<TeamUserConfig>>(),
    teamChannelConfigs: new Map<string, CachedConfig<TeamChannelConfig>>(),
    teamJiraSubscriptions: new Map<
      string,
      CachedConfig<TeamJiraSubscriptions>
    >(),

    jiraSubscriptionIndex: new Map<
      string,
      CachedConfig<JiraSubscriptionIndex>
    >(),
  }
  private bot: Bot
  private botConfig: BotConfig
  constructor(bot: Bot, botConfig: BotConfig) {
    this.bot = bot
    this.botConfig = botConfig
  }

  private async getFromCacheOrKVStore<T>(
    configCache: ConfigCache<T>,
    namespace: string,
    entryKey: string,
    jsonToConfigMapper: (objectFromJson: any) => T | undefined
  ): Promise<
    Errors.ResultOrError<
      CachedConfig<T>,
      Errors.KVStoreNotFoundError | Errors.UnknownError
    >
  > {
    try {
      const cacheKey = getCacheKey(namespace, entryKey)
      const cached = configCache.get(cacheKey)
      if (!cachedConfigExpired(cached)) {
        return Errors.makeResult<CachedConfig<T>>(cached)
      }

      const res = await this.bot.kvstore.get(
        `${this.botConfig.keybase.username},${this.botConfig.keybase.username}`,
        namespace,
        entryKey
      )
      if (!res.entryValue) {
        return Errors.kvStoreNotFoundError
      }
      let objectFromJson: Object
      try {
        objectFromJson = JSON.parse(res.entryValue)
      } catch (e) {
        await this.bot.kvstore.delete(
          `${this.botConfig.keybase.username},${this.botConfig.keybase.username}`,
          namespace,
          entryKey
        )
        configCache.delete(cacheKey)
        return Errors.kvStoreNotFoundError
      }
      const config = jsonToConfigMapper(objectFromJson)

      if (!config) {
        configCache.delete(cacheKey)
        return Errors.makeError({type: Errors.ErrorType.KVStoreNotFound})
      }

      const cachedConfig = {
        config,
        _revision: res.revision,
        _timestamp: Date.now(),
      }
      configCache.set(cacheKey, cachedConfig)
      return Errors.makeResult<CachedConfig<T>>(cachedConfig)
    } catch (err) {
      return Errors.makeUnknownError(err)
    }
  }

  private async updateToCacheAndKVStore<T>(
    configCache: ConfigCache<T>,
    namespace: string,
    entryKey: string,
    oldConfig: CachedConfig<T> | undefined,
    newConfig: T,
    configSerializer?: (config: T) => string
  ): Promise<
    Errors.ResultOrError<
      undefined,
      Errors.KVStoreRevisionError | Errors.UnknownError
    >
  > {
    try {
      const entryValue = configSerializer
        ? configSerializer(newConfig)
        : JSON.stringify(newConfig)
      const res = await this.bot.kvstore.put(
        `${this.botConfig.keybase.username},${this.botConfig.keybase.username}`,
        namespace,
        entryKey,
        entryValue,
        oldConfig ? oldConfig._revision + 1 : undefined
      )
      // TODO if revision error, purge cached entry
      configCache.set(getCacheKey(namespace, entryKey), {
        config: newConfig,
        _revision: res.revision,
        _timestamp: Date.now(),
      })
      return Errors.makeResult(undefined)
    } catch (err) {
      // TODO check and return KVStoreRevisionError
      return Errors.makeUnknownError(err)
    }
  }

  public async clearAllForTest(): Promise<any> {
    const teamname = `${this.botConfig.keybase.username},${this.botConfig.keybase.username}`
    this.bot.kvstore
      .listNamespaces(teamname)
      .then(res =>
        res.namespaces?.forEach(namespace =>
          this.bot.kvstore
            .listEntryKeys(teamname, namespace)
            .then(res =>
              res.entryKeys?.forEach(({entryKey}) =>
                this.bot.kvstore.delete(teamname, namespace, entryKey)
              )
            )
        )
      )
  }

  async getTeamJiraConfig(
    teamname: string
  ): Promise<
    Errors.ResultOrError<
      CachedConfig<TeamJiraConfig>,
      Errors.KVStoreNotFoundError | Errors.UnknownError
    >
  > {
    return await this.getFromCacheOrKVStore(
      this.cache.teamJiraConfigs,
      getNamespace(teamname),
      jiraConfigKey,
      jsonToTeamJiraConfig
    )
  }

  async getTeamUserConfig(
    teamname: string,
    username: string
  ): Promise<
    Errors.ResultOrError<
      CachedConfig<TeamUserConfig>,
      Errors.KVStoreNotFoundError | Errors.UnknownError
    >
  > {
    return await this.getFromCacheOrKVStore(
      this.cache.teamUserConfigs,
      getNamespace(teamname),
      getTeamUserConfigKey(username),
      jsonToTeamUserConfig
    )
  }

  async getTeamChannelConfig(
    teamname: string,
    conversationId: ChatTypes.ConvIDStr
  ): Promise<
    Errors.ResultOrError<
      CachedConfig<TeamChannelConfig>,
      Errors.KVStoreNotFoundError | Errors.UnknownError
    >
  > {
    return await this.getFromCacheOrKVStore(
      this.cache.teamChannelConfigs,
      getNamespace(teamname),
      getTeamChannelConfigKey(conversationId),
      jsonToTeamChannelConfig
    )
  }

  async getTeamJiraSubscriptions(
    teamname: string
  ): Promise<
    Errors.ResultOrError<
      CachedConfig<TeamJiraSubscriptions>,
      Errors.KVStoreNotFoundError | Errors.UnknownError
    >
  > {
    return await this.getFromCacheOrKVStore(
      this.cache.teamJiraSubscriptions,
      getNamespace(teamname),
      jiraSubscriptionsKey,
      jsonToTeamJiraSubscriptions
    )
  }

  async getJiraSubscriptionIndex(
    urlToken: string
  ): Promise<
    Errors.ResultOrError<
      CachedConfig<JiraSubscriptionIndex>,
      Errors.KVStoreNotFoundError | Errors.UnknownError
    >
  > {
    return await this.getFromCacheOrKVStore(
      this.cache.jiraSubscriptionIndex,
      jiraSubscriptionIndexNamespace,
      urlToken,
      jsonToJiraSubscriptionIndex
    )
  }

  async listAllJiraSubscriptionIndices(): Promise<
    Errors.ResultOrError<
      Array<JiraSubscriptionIndex>,
      Errors.KVStoreNotFoundError | Errors.UnknownError
    >
  > {
    const indicesRet = await Promise.all(
      await this.bot.kvstore
        .listEntryKeys(
          `${this.botConfig.keybase.username},${this.botConfig.keybase.username}`,
          jiraSubscriptionIndexNamespace
        )
        .then(res =>
          (res.entryKeys || []).map(({entryKey}) =>
            this.getFromCacheOrKVStore(
              this.cache.jiraSubscriptionIndex,
              jiraSubscriptionIndexNamespace,
              entryKey,
              jsonToJiraSubscriptionIndex
            )
          )
        )
    )

    const result: Array<JiraSubscriptionIndex> = []
    for (const indRet of indicesRet) {
      if (indRet.type !== Errors.ReturnType.Ok) {
        return indRet
      }
      result.push(indRet.result.config)
    }

    return Errors.makeResult(result)
  }

  async updateTeamJiraConfig(
    teamname: string,
    oldConfig: CachedConfig<TeamJiraConfig> | undefined,
    newConfig: TeamJiraConfig
  ): Promise<
    Errors.ResultOrError<
      undefined,
      Errors.KVStoreRevisionError | Errors.UnknownError
    >
  > {
    return await this.updateToCacheAndKVStore(
      this.cache.teamJiraConfigs,
      getNamespace(teamname),
      jiraConfigKey,
      oldConfig,
      newConfig
    )
  }

  async updateTeamUserConfig(
    teamname: string,
    username: string,
    oldConfig: CachedConfig<TeamUserConfig> | undefined,
    newConfig: TeamUserConfig
  ): Promise<
    Errors.ResultOrError<
      undefined,
      Errors.KVStoreRevisionError | Errors.UnknownError
    >
  > {
    return await this.updateToCacheAndKVStore(
      this.cache.teamUserConfigs,
      getNamespace(teamname),
      getTeamUserConfigKey(username),
      oldConfig,
      newConfig
    )
  }

  async updateTeamChannelConfig(
    teamname: string,
    conversationId: ChatTypes.ConvIDStr,
    oldConfig: CachedConfig<TeamChannelConfig> | undefined,
    newConfig: TeamChannelConfig
  ): Promise<
    Errors.ResultOrError<
      undefined,
      Errors.KVStoreRevisionError | Errors.UnknownError
    >
  > {
    return await this.updateToCacheAndKVStore(
      this.cache.teamChannelConfigs,
      getNamespace(teamname),
      getTeamChannelConfigKey(conversationId),
      oldConfig,
      newConfig
    )
  }

  async updateTeamJiraSubscriptions(
    teamname: string,
    oldConfig: CachedConfig<TeamJiraSubscriptions> | undefined,
    newConfig: TeamJiraSubscriptions
  ): Promise<
    Errors.ResultOrError<
      undefined,
      Errors.KVStoreRevisionError | Errors.UnknownError
    >
  > {
    return await this.updateToCacheAndKVStore(
      this.cache.teamJiraSubscriptions,
      getNamespace(teamname),
      jiraSubscriptionsKey,
      oldConfig,
      newConfig,
      teamJiraSubscriptionsToJson
    )
  }

  async setOrDeleteJiraSubscriptionIndex(
    urlToken: string,
    index?: JiraSubscriptionIndex // set to undefined to delete
  ): Promise<Errors.ResultOrError<undefined, Errors.UnknownError>> {
    if (!index) {
      try {
        await this.bot.kvstore.delete(
          `${this.botConfig.keybase.username},${this.botConfig.keybase.username}`,
          jiraSubscriptionIndexNamespace,
          urlToken
        )
      } catch (err) {
        return Errors.makeUnknownError(err)
      }
    } else {
      try {
        await this.bot.kvstore.put(
          `${this.botConfig.keybase.username},${this.botConfig.keybase.username}`,
          jiraSubscriptionIndexNamespace,
          urlToken,
          JSON.stringify(index)
        )
      } catch (err) {
        return Errors.makeUnknownError(err)
      }
    }
    // either way delete from the cache
    this.cache.jiraSubscriptionIndex.delete(urlToken)
    return Errors.makeResult(undefined)
  }
}
