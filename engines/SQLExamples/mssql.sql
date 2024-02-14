--- SCHEDULED EVENT LIST

SELECT t.id, t.enabled, t.title, t.category, t.plugin, t.target, t.timezone
   ,CASE 
      WHEN months IS NOT NULL  THEN 'yearly'
      WHEN days IS NOT NULL THEN 'monthly'
      WHEN weekdays IS NOT NULL  THEN 'weekly'
      WHEN hours IS NOT NULL  THEN 'daily'
      WHEN minutes IS NOT NULL THEN 'hourly'
      ELSE 'custom' END AS schedule
   , t.hours, t.minutes, t.weekdays --, t.days, timing
   , t.chain, t.notify_success, t.notes, t.username as createdBy
   , dateadd(s, t.created , '1970-01-01 00:00:00') created
   , dateadd(s, t.created , '1970-01-01 00:00:00') modified

FROM CRONICLE C
    cross apply OPENJSON(convert(varchar(max), c.V), '$.items') WITH (
       id varchar(256) '$.id'
     , enabled int '$.enabled'
     , target varchar(256) '$.target'
     , timezone varchar(256) '$.timezone'
     , title varchar(256) '$.title'
     , category varchar(256) '$.category'
     , plugin varchar(256) '$.plugin'
     , timing nvarchar(max) as json
     , months nvarchar(max)  '$.timing.months' as json
     , days nvarchar(max) '$.timing.days'  as json 
     , weekdays nvarchar(max)  '$.timing.weekdays' as json
     , hours nvarchar(max) '$.timing.hours' as json 
     , minutes nvarchar(max)  '$.timing.minutes' as json
     , chain varchar(256) '$.chain_success'
     , notify_success varchar(256) '$.notify_success'
     , notes varchar(MAX) '$.notes'
     , created int '$.created'
     , modified int '$.modified'
     , username varchar(256) '$.username'
    ) T
   WHERE c.K like 'global/schedule/%'


---- COMPLETED JOBS 

SELECT K
 , JSON_VALUE(job, '$.event_title') as title
 , JSON_VALUE(job, '$.plugin_title') as plugin
 , dateadd(s, convert(float,JSON_VALUE(job, '$.time_start')), '1970-01-01 00:00:00')  as started
 , ROUND(JSON_VALUE(job, '$.elapsed'), 1) as elapsed
 , JSON_VALUE(job, '$.code') as code
 , JSON_VALUE(job, '$.description') as description
 , created
 
FROM (
   select K, convert(varchar(max),V) as job, created
   from CRONICLE
   where K like 'jobs/%' and K not like '%.gz'
   ) AS JOBS
ORDER BY created

---- CATEGORY LIST
   SELECT id, title from CRONICLE 
    CROSS APPLY OPENJSON(convert(varchar(max),V), '$.items')
     WITH ( id varchar(256) '$.id', title varchar(256) '$.title')
   WHERE K like 'global/categories/%'

--- PLUGIN LIST
   SELECT id, title from CRONICLE 
    CROSS APPLY OPENJSON(convert(varchar(max),V), '$.items')
     WITH ( id varchar(256) '$.id', title varchar(256) '$.title')
   WHERE K like 'global/plugins/%'