// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiZDJvc2Jvcm4iLCJhIjoiY21hcWljbnYzMDA5cTM0cHE1ZXJ0NzF3bSJ9.lhMr0pL4IWvrkfHGq7igoA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

map.on('load', () => {
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
    });
    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': '#32D400',
            'line-width': 3,
            'line-opacity': 0.4
        }
    });
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });
    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': '#32D400',
            'line-width': 3,
            'line-opacity': 0.4
        }
    });
});

let stations = [];
let trips;
let data_glob;

let filteredArrivals = new Map();
let filteredDepartures = new Map();
let filteredStations = [];
let departuresByMinute = Array.from({ length: 1440}, () => []);
let arrivalsByMinute = Array.from({length: 1440}, () => []);

let maxRad;

let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);


map.on('load', () => {
    const jsonurl = "bluebikes-stations.json"
    d3.json(jsonurl).then(jsonData => {
        console.log('Loaded JSON Data:', jsonData);
        stations = jsonData.data.stations;
        const svg = d3.select('#map').select('svg');

    function getCoords(station) {
        const point = new mapboxgl.LngLat(+station.lon, +station.lat);  
        const { x, y } = map.project(point);  
        return { cx: x, cy: y }; 
    }

    const circles = svg.selectAll('circle')
        .data(stations)
        .enter()
        .append('circle')
        .attr('r', 5)               
        .attr('fill', 'steelblue')  
        .attr('stroke', 'white')    
        .attr('stroke-width', 1)    
        .attr('opacity', 0.8)   
        .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic));   

    function updatePositions() {
        circles
        .attr('cx', d => getCoords(d).cx)  
        .attr('cy', d => getCoords(d).cy); 
    }

    updatePositions();

    map.on('move', updatePositions);    
    map.on('zoom', updatePositions);    
    map.on('resize', updatePositions);   
    map.on('moveend', updatePositions);  
    
    trips =  d3.csv("https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv");

    trips.then(data => {
        data_glob = data;
        departures = d3.rollup(
            data,
            (v) => v.length,
            (d) => d.start_station_id,
        );
        
        let arrivals = d3.rollup(
            data,
            (v) => v.length,
            (d) => d.end_station_id,
        );
        stations = stations.map((station) => {
            let id = station.short_name;
            station.arrivals = arrivals.get(id) ?? 0;
            station.departures = departures.get(id) ?? 0;
            station.totalTraffic = station.arrivals + station.departures;
            return station;
        })

        maxRad = d3.max(stations, (d) => d.totalTraffic)
        const radiusScale = d3
            .scaleSqrt()
            .domain([0, maxRad])
            .range([0, 25]);

    
        circles.attr('r', d => radiusScale(d.totalTraffic));
        circles.each(function (d) {
            d3.select(this)
                .append('title')
                .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`)
        })
;
        for (let trip of data) {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            let startedMinutes = minutesSinceMidnight(trip.started_at);
            departuresByMinute[startedMinutes].push(trip);
            let endedMinutes = minutesSinceMidnight(trip.ended_at);
            arrivalsByMinute[endedMinutes].push(trip);
        }

    
    }).catch(error => {
        console.error('Error loading CSV:', error);  
    });
    }).catch(error => {
        console.error('Error loading JSON:', error);  
    });
});

let timeFilter = -1;

const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);  
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);  

    if (timeFilter === -1) {
        selectedTime.style.opacity = 0; 
        anyTimeLabel.style.opacity = 1; 
    } else {
        selectedTime.textContent = formatTime(timeFilter);
        selectedTime.style.opacity = 1;
        anyTimeLabel.style.opacity = 0; 
    }

    filterTripsbyTime();
}

timeSlider.addEventListener('input', updateTimeDisplay);
updateTimeDisplay();



function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime() {

    filteredDepartures = d3.rollup(
        timeFilter === -1 ? departuresByMinute.flat() : filterByMinute(departuresByMinute, timeFilter),
        (v) => v.length,
        (d) => d.start_station_id,
    );
    
    filteredArrivals = d3.rollup(
        timeFilter === -1 ? arrivalsByMinute.flat(): filterByMinute(arrivalsByMinute, timeFilter),
        (v) => v.length,
        (d) => d.end_station_id,
    );

    filteredStations = stations.map((station) => {
        let id = station.short_name;
        station = {... station };
        station.arrivals = filteredArrivals.get(id) ?? 0;
        station.departures = filteredDepartures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    })

    const svg = d3.select('#map').select('svg');

    let radiusScale;
    if (timeFilter === -1) {
        radiusScale = d3
            .scaleSqrt()
            .domain([0, maxRad])
            .range([0, 25]);        
    } else {
        radiusScale = d3
            .scaleSqrt()
            .domain([0, maxRad])
            .range([3, 50]);
    }

    const circles = svg.selectAll('circle')
        .data(filteredStations);
    circles.attr('r', d => radiusScale(d.totalTraffic));
    circles.style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic));
}

function filterByMinute(tripsByMinute, minute) {
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;

    if (minMinute > maxMinute) {
        let beforeMidnight = tripsByMinute.slice(minMinute);
        let afterMidnight = tripsByMinute.slice(0, maxMinute);
        return beforeMidnight.concat(afterMidnight).flat();
    } else {
        return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}
