local policies = cjson.decode(ARGV[1])
local eventId = ARGV[2]
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
local decisions = {}
local blocked = false
local retryAfterMs = 0

for index, policy in ipairs(policies) do
  local key = KEYS[index]
  local cutoff = now - policy.windowMs
  redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

  local count = redis.call('ZCARD', key)
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAtMs = now

  if #oldest > 0 then
    resetAtMs = tonumber(oldest[2]) + policy.windowMs
  end

  local isBlocked = count >= policy.limit
  if isBlocked then
    blocked = true
    retryAfterMs = math.max(retryAfterMs, resetAtMs - now)
  end

  decisions[index] = {
    name = policy.name,
    limit = policy.limit,
    remaining = math.max(0, policy.limit - count),
    resetAtMs = resetAtMs,
    blocked = isBlocked
  }
end

if not blocked then
  for index, policy in ipairs(policies) do
    local key = KEYS[index]
    redis.call('ZADD', key, now, eventId)
    redis.call('PEXPIRE', key, policy.windowMs)

    decisions[index].remaining = math.max(0, decisions[index].remaining - 1)

    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    decisions[index].resetAtMs = tonumber(oldest[2]) + policy.windowMs
  end
end

return cjson.encode({
  allowed = not blocked,
  nowMs = now,
  retryAfterMs = retryAfterMs,
  policies = decisions
})
