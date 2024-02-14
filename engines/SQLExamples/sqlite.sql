----- SCHEDULED JOBS 

SELECT 
  json_extract(value, '$.id') as id
, json_extract(value, '$.title') title 
, json_extract(value, '$.category') category
, json_extract(value, '$.plugin') plugin
, json_extract(value, '$.timezone') timezone
, json_extract(value, '$.target') target
, json_extract(value, '$.enabled') enabled
-- , json_extract(value, '$.timing') timing
,CASE 
      WHEN json_extract(value, '$.timing.months') IS NOT NULL  THEN 'yearly'
      WHEN json_extract(value, '$.timing.days') IS NOT NULL THEN 'monthly'
      WHEN json_extract(value, '$.timing.weekdays')  IS NOT NULL  THEN 'weekly'
      WHEN json_extract(value, '$.timing.hours') IS NOT NULL  THEN 'daily'
      WHEN json_extract(value, '$.timing.minutes') IS NOT NULL THEN 'hourly'
      ELSE 'custom' END AS schedule
, json_extract(value, '$.timing.hours') hours
, json_extract(value, '$.timing.minutes') minutes
, json_extract(value, '$.timing.weekdays') weekdays
--, json_extract(value, '$.timing.months') months
--, json_extract(value, '$.timing.days') days
, json_extract(value, '$.chain') chain
, json_extract(value, '$.notify_success') notify_success
, json_extract(value, '$.notes') notes
, json_extract(value, '$.username') username
, datetime(json_extract(value, '$.created'), 'unixepoch', 'localtime')  created
, datetime(json_extract(value, '$.modified'), 'unixepoch', 'localtime') modified

FROM (
  SELECT K, V from cronicle c 
  WHERE K like 'global/schedule/%'
) S, json_each( S.V, '$.items') J


---- COMPLETED JOBS

SELECT json_extract(V, '$.id') id
 , json_extract(V, '$.event_title') as title
 , json_extract(V, '$.plugin_title') as plugin
  , json_extract(V, '$.category_title') as category
 , json_extract(V, '$.target') as target
 , datetime(json_extract(V, '$.time_start'), 'unixepoch', 'localtime') as start_time
 , ROUND(json_extract(V, '$.elapsed'), 1) as elapsed
 , json_extract(V, '$.code') as code
 , json_extract(V, '$.description') as description
 , updated
  FROM  cronicle C
WHERE c.K LIKE  'jobs/%' AND c.K NOT LIKE '%.gz'

--- PLUGIN LIST
  SELECT 
    json_extract(value, '$.id') as id
  , json_extract(value, '$.title') title
  FROM  cronicle c, json_each( c.V, '$.items')
  WHERE K like 'global/plugins/%'
  
---- CATEGORY LIST
  SELECT 
    json_extract(value, '$.id') as id
  , json_extract(value, '$.title') title
  FROM  cronicle c, json_each( c.V, '$.items')
  WHERE K like 'global/categories/%'