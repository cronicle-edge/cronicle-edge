---- SCHEDULED EVENT LIST

 SELECT  t.id, t.enabled enabled, t.title, t.category AS catid, t.plugin AS plugid, t.target, t.timezone
   ,CASE 
      WHEN months IS NOT NULL  THEN 'yearly'
      WHEN days IS NOT NULL THEN 'monthly'
      WHEN weekdays IS NOT NULL  THEN 'weekly'
      WHEN hours IS NOT NULL  THEN 'daily'
      WHEN minutes IS NOT NULL THEN 'hourly'
      ELSE 'custom' END AS schedule
   , nvl(JSON_VALUE(minutes, '$.size()'), 60) * nvl(JSON_VALUE(hours, '$.size()'), 24) AS DR -- daily runs 
   , hours, minutes, weekdays --, days, months
   ,chain, notify_success, notes, username AS createdBy
   , to_date('1970-01-01 00:00:00', 'yyyy-mm-dd hh24:mi:ss') + t.created/24/3600 AS created
   , to_date('1970-01-01 00:00:00', 'yyyy-mm-dd hh24:mi:ss') + t.modified/24/3600 AS updated
   
 FROM CRONICLE C, JSON_TABLE( c.V, '$.items[*]' columns (
 id, title, category, plugin, timezone, target, chain, notify_success, notes, username
   , created int
   , modified int
   , enabled NUMBER(2)
   , timing FORMAT json
   , months FORMAT json PATH '$.timing.months'
   , days FORMAT json PATH '$.timing.days'
   , weekdays FORMAT json PATH '$.timing.weekdays'
   , hours FORMAT json PATH '$.timing.hours'
   , minutes FORMAT json PATH '$.timing.minutes'
 )) T
 WHERE K like 'global/schedule/%'

---- COMPLETED JOBS 
 SELECT K
 , JSON_VALUE(V, '$.event_title') as title
 , JSON_VALUE(V, '$.plugin_title') as plugin
 , JSON_VALUE(V, '$.target') as target
 , to_date('19700101', 'YYYYMMDD') + cast(JSON_VALUE(V, '$.time_start') AS float)/24/3600  as started
 , ROUND(JSON_VALUE(V, '$.elapsed'), 1) as elapsed
 , JSON_VALUE(V, '$.code') as code
 , JSON_VALUE(V, '$.description') as description
 , created
FROM CRONICLE
WHERE K LIKE  'jobs/%' AND K NOT LIKE '%.gz'


---- PLUGIN LIST
 SELECT j.id, j.title  FROM CRONICLE C, JSON_TABLE( c.V, '$.items[*]'
   columns ( id varchar(256), title varchar(256))) J
 WHERE c.K like 'global/plugins/%'
 
 ---- CATEGORY List 
 SELECT j.id, j.title  FROM CRONICLE C, JSON_TABLE( c.V, '$.items[*]'
   columns ( id varchar(256), title varchar(256))) J
 WHERE c.K like 'global/categories/%'