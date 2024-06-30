import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import L from 'leaflet';
import './App.css';
import coData from './coo.json';
import * as Tone from 'tone';
import bottomMaskPng from '/src/music/maks.png';
import areaGif from '/src/music/tree.gif'; 

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

function LocationMarker({ onLocationUpdate, isListening }) {
  const [position, setPosition] = useState(null);
  const map = useMapEvents({
    locationfound(e) {
      setPosition(e.latlng);
      map.flyTo(e.latlng, map.getZoom());
      if (isListening) {
        onLocationUpdate(e.latlng);
      }
    },
  });

  useEffect(() => {
    if (isListening) {
      map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true, watch: true });
    } else {
      map.stopLocate();
    }
  }, [map, isListening]);

  return position === null ? null : (
    <Marker position={position}>
      <Popup>You are here</Popup>
    </Marker>
  );
}

function App() {
  const [leftMenuOpen, setLeftMenuOpen] = useState(false);
  const [rightMenuOpen, setRightMenuOpen] = useState(false);
  const [bottomPageOpen, setBottomPageOpen] = useState(false);
  const [savedAreas, setSavedAreas] = useState([]);
  const [gpsStatus, setGpsStatus] = useState("Waiting for GPS...");
  const [isListening, setIsListening] = useState(false);
  const [route, setRoute] = useState([]);
  const [decibelLevels, setDecibelLevels] = useState([]);
  const [currentDecibel, setCurrentDecibel] = useState(0);
  const [distanceTraveled, setDistanceTraveled] = useState(0);
  const [areaVisited, setAreaVisited] = useState(0);
  const [songsObtained, setSongsObtained] = useState(0);
  const [selectedArea, setSelectedArea] = useState(null);
  const [listeningIntervalId, setListeningIntervalId] = useState(null);
  const mapRef = useRef();
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const synth = useRef(null);

  useEffect(() => {
    setSavedAreas(coData);

    if ("geolocation" in navigator) {
      navigator.geolocation.watchPosition(
        (position) => {
          setGpsStatus(`GPS active. Lat: ${position.coords.latitude.toFixed(4)}, Lon: ${position.coords.longitude.toFixed(4)}`);
        },
        (error) => {
          setGpsStatus(`GPS error: ${error.message}`);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      setGpsStatus("GPS not available");
    }

    synth.current = new Tone.Synth().toDestination();
  }, []);

  useEffect(() => {
    if (route.length > 1) {
      let distance = 0;
      for (let i = 1; i < route.length; i++) {
        distance += calculateDistance(
          route[i-1].lat, route[i-1].lng,
          route[i].lat, route[i].lng
        );
      }
      setDistanceTraveled(distance / 1000); // Convert to kilometers
      setAreaVisited(Math.abs(L.GeometryUtil.geodesicArea(route)));
    }
  }, [route]);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  };

  const isOverlapping = (newArea) => {
    return savedAreas.some(area => {
      const distance = calculateDistance(
        newArea.center[0], newArea.center[1],
        area.center[0], area.center[1]
      );
      return distance < (newArea.radius + area.radius);
    });
  };

  const recordSoundsForArea = () => {
    return new Promise((resolve) => {
      const samples = [];
      const intervalId = setInterval(() => {
        const decibelLevel = getDecibelLevel();
        samples.push(decibelLevel);
      }, 100);

      setTimeout(() => {
        clearInterval(intervalId);
        const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        resolve(average);
      }, 5000);
    });
  };

  const saveCurrentPosition = () => {
    const map = mapRef.current;
    if (map) {
      const center = map.getCenter();
      
      setTimeout(async () => {
        await startAudioContext();
        const averageDecibel = await recordSoundsForArea();
        stopAudioContext();

        const radius = 500;
        let color;
        
        if (averageDecibel === 0) {
          color = 'blue';
        } else {
          const hue = Math.max(0, 200 - (averageDecibel * 2));
          const lightness = Math.max(20, 80 - (averageDecibel * 1.5));
          color = `hsl(${hue}, 70%, ${lightness}%)`;
        }

        const newArea = {
          center: [center.lat, center.lng],
          radius: radius,
          color: color,
          song: 'Sample Song',
          averageDecibel: averageDecibel
        };

        if (!isOverlapping(newArea)) {
          setSavedAreas(prevAreas => [...prevAreas, newArea]);

          const jsonData = JSON.stringify({
            latitude: center.lat,
            longitude: center.lng,
            timestamp: new Date().toISOString(),
            averageDecibel: averageDecibel
          });

          console.log("Saved coordinates:", jsonData);
          localStorage.setItem('lastSavedPosition', jsonData);
        } else {
          alert("Cannot save area: It overlaps with an existing area.");
        }
      }, 5000);
    }
  };

  const startAudioContext = async () => {
    try {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStreamRef.current = stream;
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      alert("Unable to access microphone. Please check your permissions.");
    }
  };

  const stopAudioContext = () => {
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
  };

  const getDecibelLevel = () => {
    if (!analyserRef.current) return 0;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    const decibels = 20 * Math.log10(average / 255);

    return Math.max(0, decibels);
  };

  const toggleListening = async () => {
    if (!isListening) {
      await startAudioContext();
      setIsListening(true);
      setRoute([]);
      setDecibelLevels([]);
      
      const intervalId = setInterval(() => {
        const decibelLevel = getDecibelLevel();
        setCurrentDecibel(decibelLevel);
        setDecibelLevels(prev => [...prev, decibelLevel]);
      }, 1000);
      
      setListeningIntervalId(intervalId);
    } else {
      stopAudioContext();
      setIsListening(false);
      
      if (listeningIntervalId) {
        clearInterval(listeningIntervalId);
      }
    }
  };

  const handleLocationUpdate = (latlng) => {
    if (isListening) {
      const newRoute = [...route, latlng];
      setRoute(newRoute);
      
      const decibelLevel = getDecibelLevel();
      setDecibelLevels([...decibelLevels, decibelLevel]);
    }
  };

  const playSong = () => {
    synth.current.triggerAttackRelease("C4", "8n");
  };

  const takeSong = () => {
    setSongsObtained(songsObtained + 1);
    setBottomPageOpen(false);
  };

  const toggleLeftMenu = () => {
    if (rightMenuOpen || bottomPageOpen) {
      setRightMenuOpen(false);
      setBottomPageOpen(false);
    }
    setLeftMenuOpen(!leftMenuOpen);
  };

  const toggleRightMenu = () => {
    if (leftMenuOpen || bottomPageOpen) {
      setLeftMenuOpen(false);
      setBottomPageOpen(false);
    }
    setRightMenuOpen(!rightMenuOpen);
  };

  const handleAreaClick = (area) => {
    setSelectedArea(area);
    if (leftMenuOpen || rightMenuOpen) {
      setLeftMenuOpen(false);
      setRightMenuOpen(false);
    }
    setBottomPageOpen(true);
  };

  return (
    <div className="app">
      <div className="map-container">
        <MapContainer 
          center={[43.7696, 11.2558]} 
          zoom={13} 
          style={{ height: "100%", width: "100%" }}
          ref={mapRef}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <LocationMarker onLocationUpdate={handleLocationUpdate} isListening={isListening} />
          {savedAreas.map((area, index) => (
            <Circle
              key={index}
              center={area.center}
              radius={area.radius}
              pathOptions={{ fillColor: area.color, fillOpacity: 0.5, color: area.color }}
              eventHandlers={{
                click: () => handleAreaClick(area),
              }}
            />
          ))}
          {route.length > 1 && (
            <Polyline
              positions={route}
              pathOptions={{ color: 'red', weight: 3 }}
            />
          )}
        </MapContainer>
      </div>
      <div className="gps-status">{gpsStatus}</div>
      <div className="bottom-buttons-container">
        <button className="songs-button" onClick={toggleLeftMenu}></button>
        <button className="position-button" onClick={saveCurrentPosition}></button>
        <button className="route-button" onClick={toggleListening}></button>
        <button className="stats-button" onClick={toggleRightMenu}></button>
      </div>
      <div className={`left-menu ${leftMenuOpen ? 'open' : ''} menu`}>
        <h2>Songs</h2>
        <p>dio</p>
        <button className="exit" onClick={() => setLeftMenuOpen(false)}></button>
      </div>
      <div className={`right-menu ${rightMenuOpen ? 'open' : ''} menu`}>
        <h2>Stats</h2>
        <p>Current Decibel Level: {currentDecibel.toFixed(2)} dB</p>
        <button className="exit" onClick={() => setRightMenuOpen(false)}></button>
      </div>
      {bottomPageOpen && selectedArea && (
        <div className="bottom-page" style={{
          backgroundImage: `url(${bottomMaskPng})`,
          backgroundPosition: 'top',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% auto'
        }}>
          <div className="gif-container" style={{
            height: '50%',
            overflow: 'hidden',
            position: 'relative',
            zIndex: 1
          }}>
            <img 
              src={areaGif} 
              alt="Area GIF" 
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                animationDuration: `${Math.max(0.5, 2 - (selectedArea.averageDecibel / 50))}s`
              }}
            />
          </div>
          <div style={{position: 'relative', zIndex: 2}}>
            <h2>{selectedArea.song}</h2>
            <p>Average Decibel Level: {selectedArea.averageDecibel.toFixed(2)} dB</p>
            <button onClick={playSong}>Play</button>
            <button onClick={takeSong}>Take Song</button>
            <button onClick={() => setBottomPageOpen(false)}>Water</button>
            <button className="exit" onClick={() => setBottomPageOpen(false)}></button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;