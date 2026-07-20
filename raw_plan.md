# Portqueue
Queue implementation for nodejs, that supports different databases as data source.
Has a wide range of features from concurrency, rate limiting, monitoring, event driven, horizontally scalable, transactional, uses pub/sub implementations etc.
Absolutely free, open-source, open for commercial use, no license needed.
Default drivers that are supported from the start are Postgres, Oracle, PGLite, SQLite.

## Structure
- Use ../ai-utils shared-lib ai skill to setup that lib
- have a /docs package with docs in docusaurus
- Linted/prettier, tested with Jest etc as described in ai-utils
- Use vite and generate both simple js and mjs and other build types that may be needed.
- Exported TS type to be published (Importable and dev friendly)
- Github Pages pipeline to deploy to github pages (named deploy-docs) (only on main branch)
- Github pipeline for linting and testing on every push (on every branch)
- Github pipeline to publish to npm (only on main branch)
- An dashboard package written in react, that can be used as a middleware in raw node server or express or koa or fastify, which will serve our dashboard
- Main package folder should be named core (even tho the npm name should be the @portqueue/core)
- Then we should have teh dashboard package folder named dashboard and the npm name should be @portqueue/dashboard
- In publish pipeline have a tool that generates and pushes the change log to main (but doesn't trigger a repeated publish)
- For core package and where we keep the logic use a Class coding style and use typedi for that, split the code in meaningful parts, have small focused classes, and split the code accordingly, and reuse as much as possible
- Each big part should be in its own folder and maybe split even further, the pub/sub in one service, the initialization in another, the jobs handlers in another, the scheduler in another and so on.
- Avoid third party libs unless specified or very necessary
- Have a CLI interface maybe @portqueue/cli package, it should be used to get statistics (kinda same as we do with the dashboard but with a cli interface). 
- Have a super open license
- Have the readme with contributions guides and links and descriptions to the docs

## Features
- Should support multiple databases, the starting ones should be Postgres, PGLite, Oracle, SQLite
- Should use a Driver like coding structure and allow the devs to pass a different custom driver if they want to integrate a different DB, We should have a common driver interface which we follow for all our drivers
- To listen for new jobs or changes in the jobs table it should use the Listen/Notify features for the DB that is currently in usage
- If a DB doesn't support a Listen/Notify structure it should use a interval structure.
- Horizontal scalable, which means if deployed to many servers at once, it can work together with many instances, for that to not end up in a concurrency race with other instances, for DBs that support SKIP/LOCK it will use that to lock the current row while working on it.
- Failure tolerant, It should catch any error from the queue handlers, and never stop, we should aim to never have some code that crashes, while we also should always log everything that's happening (depending on log level)
- Developer faintly API, we should look at similar libraries like pg-boss and bullMQ and implement just the best developer friendly patterns, as a developer the usage of that lib should be seamless. This also means that the methods should try to avoid to use positional arguments, if a method needs more than one argument then that argument should be an object with meaningful property names.
- We should support Transactions, the dev should be able to pass a transaction instance and in that case we should use that, check how that is done in pg-boss, but implement better.
- No much reliance on third party libs, we use libs only to connect to the dbs in most part, the oracledb for oracle and so on for other dbs, (Just the raw ones no ORMs)
- No auto installing any third-party lib for the dev, libs used in drivers and etc, these would be peer-dependencies depending on which DB the user wants to use.
- The queues should support rate limiting, concurrency and various dev friendly options.
- The jobs also should have at their level options so they can deviate from the Queue level options if needed. The Job level options should take priority in that case if is a duplicated option.
- It is allowed the created tables to deviate based on teh used DB, somewhere to achieve something we may need 3 tables but with some implementations just 2
- The API used by the dev no mater what is the driver should be the same, methods that are not supported by a user should be still callable but these should throw incompatibility errors (Which should be rare, and we should find ways to make these compatible and use same interface at the end)
- Minimal number of tables created, only unless very needed (take a look how pg-boss is doing and improve do even better)
- Try to avoid json for columns created by us (check pg-boss and do even better)
- Have the capability to only run the handlers or only send jobs on different servers, these 2 actions should be somehow distinct as in bullmq, maybe we should use a worker like structure.
- Have some automatic mechanism that can migrate from a version to another
- Be secure by default, have security tests related, avoid injections etc.
- Both delayed and (every setting) jobs should be supported. For the every setting that should be still something in seconds or a method that returns the next delay, maybe let's name it repeat_delay (came up with a good name), maybe even let's name it cron and support crons
- The cron feature should reschedule a different job and not the same, we should support also some type of repeat_id/cron_id, so we know that these jobs belong to same initial job, a cron job under teh hod just calculate next delay and adds the next one
- When adding a job for the dev we should not return just the job ID but always add object with result that will contain all the needed info, if is a repeated one, it should also contain the repeat_id/cron_id
- We should also support idempotency_id and not alow adding multiple with same idempotency id
- All the ids btw should be UUIDs generated by the db, or maybe by the user if that is the idempotency key (These btw are compatible with repeat_key so that same repeatable job is not added multiple times)
- Keep as much as possible in the JOBS table so we do not have to join much and avoid at all joins since many tables do not even support it.
- Have settings that dev can pass and select the db schema, and prefixing the created tables, (have some cool options that the user can use and customize that part).
- Support multi-step queue with multiple steps predefined at the start with multiple handlers. Use enums for steps. Allow repeating at a sudden step.
- Do not implement Progress functional same as in bullmq since it doesn't allow to start from the remaining progress
- If a type of queue handler supports a method and another not, still export that method and just throe error so that user knows that such method exists but for taht case it is not usable and he needs other path of doing things
- Have events for all possible cases, both generic and specific ones, have a event driven structure.
- Beside the rate limiting options at job level, we should have also some service that monitors the system itself and not process jobs when that is under pressure, we should also be able to configure it as well
- Should have the functional to gracefully shutdown
- Have a good meaningful logger mechanism
- Avoid magic strings when possible. And rely mostly on enums when possible
- Be strictly typised and avoid the usage of any type when possible
- Support timezones for cron jobs
- Support custom drivers that implement our interface
- Have retention setting, where user can set how much to store a job in the DB and when to auto deleted, (By default do not delete anything after any period), but have a retention service, or a clean uo service that may take care of these
- At jobs level maybe even store on which server that job was run, this way in the Dashboard we can have a statistic which servers and how much jobs these did run, if is docker get container id, if is server get product uuid, also have a column that tells the product id type wether is an container or bare metal etc etc so we know the source
- Have events like before task publishing/after, before something and after something, we should allow the dev to maybe run custom code and such events should help him
- Events names should not be just magic strings but enums, so that the dev can import and use and know what are all possible events.
- Should support job priority options
- We should not support worker threads for now, the job handlers can run on main process, but we should keep in mind that in future versions we will, and interface should be structured and created ina way that in future it will be easy to implement it over

## Testing
- Tested with Jest
- Should aim for a 100% coverage, but that may not be possible.
- In tests as the drivers we should use only the PGLite db and SQLite db, since these are teh easiest for testing.
- We should aim to use clean dbs for every describe/spec maybe
- We should use teh InMemory implementations, and even if using the file ones we should always clean at the end.
- Less mocks of third party libraries, if a lib needs mocking we may think of replacing with a custom implementation of our own.
- Have not just use case tests, but also security test and integration etc.
- When testing jobs with delay or or (every setting) we should avoid long running tests and limit these tests to up to few seconds or up to minute so we do not wait much for tests to end

## Documentation
- As said docs live in /docs
- We should us Docusaurus 
- Have the Github pipelines setup to publish the docs to github pages
- We should have a search functional (Let's investigate what are the solutions toa void third party services)
- We should have a beautiful landing page
- We should have a footer on all pages
- We should have a header on all pages
- We should always show the version in header somewhere on right side
- We should have info on main page that says that he lib is free and open source and no license needed for commercial usage.
- In teh docs pages itself on the left we need a sidebar with all topics and subtopics, and on right we need to have a sidebar kinda for all topics and subtopics on that page.
- We need buttons to navigate to prev and next page, and in between button that users can click and report something wrong in the docs, and that will bring them to our github issues page in a new tab.
- We should support by default light and dark theme, and that should switch based on user preference, we should have a switcher. That preference should be reset if a event from user pc we get that he changes the theme mode.
- I header have a link to our github, that will open in a new tab (Ask for github svg or use a image from open internet)
- No need for a logo, our name would be a logo, maybe we'll think for the name to use a deferent font.
- The design should be modern and shareable with the dashboard so these feel like are built for same project
- Let's have in /packages some package only for the UI part, also let's use some css-in-js styling lib, check what is recommended by ant design
- Support images, if a image, let's have a folder with images, and when a image is needed for example for teh Dashboard and there is none just put a placeholder with the alt text and then I'll add that image.
- In docs we need to put a focus on the scalability and tell how scalable it is, and about the technics we use to achieve that.
- For every code example we should not just have a card with the code, but that card should actually have tabs and show the example for all databases f it differs if is same for all dbs we should indicate that.
- For installation the same we should have card with tabs with all the cases and coding examples
- For coding we should have it highlighted in docs, and coding examples with different tabs for every driver/package manager etc if applicable
- We should use icons and images as much as possible
- For the UI lib let's use ANTD design
- We should split the docs meaningfully and not jump from topic to topic
-  We should have a dev friendly introduction process, with Getting Started pages etc etc.
- We should have a Blog page as well, where we will share usage blogs, stories etc etc. Also statically generated.
- Let's have at least 5 initial blog posts there with stories of how good the lib is and what are the use cases and how some features may be used, and comparison between this lib and others, and show the forte parts of that lib.
- for teh footer use some light colors
- Have the search in teh center of the header
- for the search input have a light grey maybe BG and a shadow but not really a border
- The menu on left sidebar split meaningfully in topics, and ordered meaningly by their priority
- In footer deduct what should be the pages, maybe a changelog one that points to github changelog file in the root
- Have a shared theme config with the monitor package
- Have pages that describe all possible events and their use cases 
- Have pages with optimizations and performance suggestions, tell the user how to optimize the connection and so on
- When mentioning something in the docs, have the mentions as links that open in new tabs so the user can easily click and navigate
- Have related suggestions at the end of page with links (maybe have a config with related pages and use)
- Have contributions page

## Monitoring
- As said in the /packages/dashboard we should have a react dashboard that users can use standalone and serve themselves in their express, koa, fastify, raw node servers.
- The dashboard should use same stylistic components as our docs, these should share same design guidelines.
- It should work similar how teh graphql playground is shipped you can plug in a server and it is served.
- It should not btw request the db connection again, what it should do it should use the Portqueue instance which teh developer should provide.
- In docs have examples on how to use that dashboard.
- Also have an example on how to secure that with basic auth middleware for example.
- The main page should be wih statistics about in_progress/failed/stale/success jobs for every queue.
- Have graph with totals etc etc, come up with a page layout that make sense and shows all teh needed infos.
- Every queue should have it's separate page with details.
- Every job then should also have it's separate page with details, and ability to clone the job or remove or repeat.
- Every queue page should have the capability to add jobs or stop the queue from accepting jobs and handling them (Should still store in db but not handle)
- For the UI lib let's use ANTD design same as in teh docs so we can share things
- Have bulk actions for jobs and queues

## CLI
- We should have a cli interface, that user can use and get monitoring insides, or statistics, or any action that is possible even programmatically
- The CLI itself should also be able tos tart the Dashboard and server that, that would be one more option that e should list beside the one for express middleware etc etc, in that case it should ask for root password and root username so that the user can access that.
- In the Dashboard docs also have this part that it can be started even from the cli, put that as first option, also have in docs on how to run that from docker using the CLI. The cli server should be just a simple node server that serves the dashboard.
- To connect to the db the cli should have arguments that it accepts and uses to connect.
- The cli should also have the possibility to run infinitely when listening to events
- The CLI should be user friendly, use colors if possible


## Final suggestions
- Make sure the options/settings are declared meaningful where these make sense, do not combine job options with worker options and mix and confide teh devs
- Have a clean api, but do not limit the dev in their actions
- Have good error messages not generic ones, explain in detail what is the problem and how to fix
- In docs explain why some approach was chosen over another
- Always tell how to optimize things
- Always find ways to improve the code or reuse parts
- Avoid long files, rethink always the code and find teh best option, do not one shot the features always do a deep thinking process and find the best way from a developer experience and performance side
- Always keep in mind that this tool may be run in parallel on multiple servers at once, be server instance agnostic
- Always check for best practices, maybe even consult alternatives like Celery from python and get from there best practices or from pg-boss, or bullmq, weight all implementations and take teh best
