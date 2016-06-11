Scrapes [NSW Register of penalty notices](http://www.foodauthority.nsw.gov.au/penalty-notices/default.aspx?template=results), and converts to geocoded data set.

* .crawlercache   - Cache of downloaded web pages
* .datalogs       - Where various data transformations are logged
* .geocodercache  - Cache of google geocoding results
* .lastupdated    - Stores the value of when the penalty notices list web page was last updated

To run:

    node app -k <Google Maps API key) -o <output directory> (-l <limit>) (-c (clear cache))

Use at your own risk.