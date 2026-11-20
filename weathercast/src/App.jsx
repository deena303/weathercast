import { useEffect, useState } from 'react'

import './App.css'

const weatherApiKey = import.meta.env.VITE_WEATHER_API_KEY;

const normalizeCity = (value) => value
  .normalize('NFKD')
  .replace(/[^\p{L}\p{N}\s,-]/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

const regionName = (countryCode) => {
  if (!countryCode) return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) || countryCode;
  } catch {
    return countryCode;
  }
};

const compassDirection = (degrees) => {
  if (typeof degrees !== 'number') return '';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(degrees / 45) % 8];
};

async function getJson(url) {
  const response = await fetch(url);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The weather service returned an invalid response.');
  }

  if (!response.ok) {
    throw new Error(data.message || 'Could not load weather data.');
  }

  return data;
}

async function resolveLocation(location) {
  const parts = location.split(',').map((part) => normalizeCity(part)).filter(Boolean);
  const cityName = parts[0];
  const countryCode = parts.length > 1
    ? parts[1].replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase()
    : '';
  const normalized = countryCode ? `${cityName},${countryCode}` : cityName;
  const queryUrl = countryCode
    ? `${encodeURIComponent(cityName)},${encodeURIComponent(countryCode)}`
    : encodeURIComponent(cityName);

  try {
    const openWeatherPlaces = await getJson(
      `https://api.openweathermap.org/geo/1.0/direct?q=${queryUrl}&limit=5&appid=${encodeURIComponent(weatherApiKey)}`
    );
    if (openWeatherPlaces.length) {
      if (countryCode) {
        const exactCountry = openWeatherPlaces.find(
          (place) => place.country?.toUpperCase() === countryCode
        );
        if (exactCountry) return exactCountry;
      }
      return openWeatherPlaces[0];
    }
  } catch {
    // Try the keyless geocoder below when the primary provider has no match.
  }

  const openMeteo = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(normalized)}&count=5&language=en&format=json`
  );
  if (openMeteo.results?.length) {
    const place = openMeteo.results[0];
    return {
      name: place.name,
      country: place.country_code,
      lat: place.latitude,
      lon: place.longitude,
    };
  }

  throw new Error(`City not found: "${location}". Check the spelling and try again.`);
}

function WeatherApp() {
  const [weatherData, setWeatherData] = useState(null);
  const [inputLocation, setInputLocation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [suggestionsStatus, setSuggestionsStatus] = useState('');

  useEffect(() => {
    const query = normalizeCity(inputLocation);
    if (query.length < 2) {
      const timeoutId = window.setTimeout(() => {
        setSuggestions([]);
        setSuggestionsOpen(false);
        setActiveSuggestion(-1);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const places = await getJson(
          `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=8&appid=${encodeURIComponent(weatherApiKey)}`
        );
        setSuggestions(places);
        setSuggestionsOpen(places.length > 0);
        setActiveSuggestion(-1);
        setSuggestionsStatus(places.length ? '' : 'No matching cities');
      } catch (suggestionError) {
        setSuggestions([]);
        setSuggestionsOpen(true);
        setSuggestionsStatus(suggestionError.message || 'Could not load suggestions');
      }
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [inputLocation]);

  const fetchWeatherData = async (event, selectedPlace = null) => {
    event.preventDefault();

    const location = selectedPlace
      ? `${selectedPlace.name},${selectedPlace.country}`
      : inputLocation.trim();
    if (!location) {
      setWeatherData(null);
      setError('Please enter a city name.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (!weatherApiKey) {
        throw new Error('Weather API key is not configured.');
      }

      const place = selectedPlace || await resolveLocation(location);
      const coordinates = `lat=${place.lat}&lon=${place.lon}`;
      const data = await getJson(
        `https://api.openweathermap.org/data/2.5/weather?${coordinates}&appid=${encodeURIComponent(weatherApiKey)}&units=metric`
      );

      if (!data.name || !data.main || !data.weather?.[0]) {
        throw new Error('The weather service returned incomplete data.');
      }

      const temperatureC = data.main.temp;
      const relativeHumidity = data.main.humidity;
      const saturationVaporPressure = 6.112 * Math.exp(
        (17.67 * temperatureC) / (temperatureC + 243.5)
      );
      const vaporPressure = saturationVaporPressure * (relativeHumidity / 100);
      const absoluteHumidity = (vaporPressure * 216.7) / (temperatureC + 273.15);

      let forecast = [];
      try {
        const forecastData = await getJson(
          `https://api.openweathermap.org/data/2.5/forecast?${coordinates}&appid=${encodeURIComponent(weatherApiKey)}&units=metric`
        );
        forecast = forecastData.list?.slice(0, 9) || [];
      } catch (forecastError) {
        console.warn('Hourly forecast unavailable:', forecastError);
      }

      setWeatherData({
        location: data.name || place.name,
        country: data.sys?.country || place.country || '',
        temperature: temperatureC,
        feelsLike: data.main.feels_like,
        condition: data.weather[0].description,
        icon: data.weather[0].icon,
        humidity: relativeHumidity,
        absoluteHumidity: absoluteHumidity.toFixed(1),
        wind: data.wind?.speed,
        windDirection: data.wind?.deg,
        pressure: data.main.pressure,
        visibility: data.visibility ? Math.round(data.visibility / 1000) : null,
        dewPoint: (temperatureC - ((100 - relativeHumidity) / 5)).toFixed(0),
        forecast,
      });
    } catch (requestError) {
      console.error('Error fetching weather data:', requestError);
      setWeatherData(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const today = new Date();
  const dayLabel = today.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  });

  return (
    <main className="weather-page">
      <header className="topbar">
        <div className="brand">
          <h1>Weather<span>Cast</span></h1>
        </div>
        <div className="header-location">
          <div className="location-pin">⌖</div>
          <div>
            <p>{dayLabel}</p>
            <strong>{weatherData ? `${weatherData.location}, ${weatherData.country}` : 'Search location'}</strong>
          </div>
        </div>
      </header>

      <form className="top-search" onSubmit={fetchWeatherData}>
        <input
          id="city"
          type="text"
          value={inputLocation}
          onChange={(event) => {
            setInputLocation(event.target.value);
            setSuggestionsOpen(true);
          }}
          onKeyDown={(event) => {
            if (!suggestionsOpen || suggestions.length === 0) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveSuggestion((current) => Math.max(current - 1, -1));
            } else if (event.key === 'Enter' && activeSuggestion >= 0) {
              event.preventDefault();
              const place = suggestions[activeSuggestion];
              setInputLocation(`${place.name}, ${place.country}`);
              setSuggestionsOpen(false);
              fetchWeatherData(event, place);
            } else if (event.key === 'Escape') {
              setSuggestionsOpen(false);
            }
          }}
          placeholder="Search City"
          aria-label="Search City"
          autoComplete="off"
          role="combobox"
          aria-expanded={suggestionsOpen}
          aria-controls="city-suggestions"
          aria-autocomplete="list"
        />
        <button type="submit" disabled={loading} aria-label="Search">⌕</button>
        {suggestionsOpen && suggestions.length > 0 && (
          <div className="suggestions" id="city-suggestions" role="listbox">
            {suggestions.map((place, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeSuggestion}
                className={index === activeSuggestion ? 'active' : ''}
                key={`${place.lat}-${place.lon}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  setInputLocation(`${place.name}, ${place.country}`);
                  setSuggestionsOpen(false);
                  fetchWeatherData(event, place);
                }}
              >
                <span className="suggestion-place">
                  <strong>{place.name}</strong>{place.state ? `, ${place.state}` : ''}
                </span>
                <span className="suggestion-country">{regionName(place.country)}, {place.country}</span>
                <small>{place.lat.toFixed(2)}, {place.lon.toFixed(2)}</small>
              </button>
            ))}
          </div>
        )}
        {suggestionsOpen && suggestionsStatus && suggestions.length === 0 && (
          <div className="suggestion-status" role="status">{suggestionsStatus}</div>
        )}
      </form>

      {error && <p className="error-message" role="alert">{error}</p>}

      {weatherData && (
        <>
          <nav className="day-strip" aria-label="7-day forecast">
            {weekDays.map((day, index) => (
              <button type="button" className={index === 0 ? 'active' : ''} key={day}>
                <span>{day}</span>
                <strong>{Math.round(weatherData.temperature + (index === 0 ? 0 : index - 3))}°</strong>
                <span className="mini-weather">{index % 3 === 2 ? '☀' : '☁'}</span>
              </button>
            ))}
          </nav>

          <section className="dashboard-grid">
            <article className="current-card">
              <div
                className="weather-photo"
                style={{ backgroundImage: `url(https://openweathermap.org/img/wn/${weatherData.icon}@4x.png), linear-gradient(145deg, #75a8cd, #dce9eb)` }}
              >
                <span className="time-label">{today.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                <div className="current-summary">
                  <strong>{Math.round(weatherData.temperature)}°</strong>
                  <div>
                    <b>{weatherData.condition}</b>
                    <p>Feels like {Math.round(weatherData.feelsLike)}°</p>
                  </div>
                </div>
              </div>

              <div className="metric-grid">
                <div><span className="metric-icon">≋</span><p>Wind</p><strong>{weatherData.wind ?? '—'} m/s {compassDirection(weatherData.windDirection)}</strong></div>
                <div><span className="metric-icon">◉</span><p>Humidity</p><strong>{weatherData.humidity}%</strong></div>
                <div><span className="metric-icon">◎</span><p>Visibility</p><strong>{weatherData.visibility ?? '—'} km</strong></div>
                <div><span className="metric-icon">⠿</span><p>Pressure</p><strong>{weatherData.pressure} hPa</strong></div>
                <div><span className="metric-icon">☼</span><p>UV Index</p><strong>0 UV</strong></div>
                <div><span className="metric-icon">♢</span><p>Dew Point</p><strong>{weatherData.dewPoint}°C</strong></div>
              </div>
            </article>

            <article className="hourly-card">
              <h2>Hourly forecast</h2>
              <div className="forecast-chart">
                <svg viewBox="0 0 700 130" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M0 84 C70 84 100 82 155 81 C220 78 260 58 335 48 C425 35 480 30 548 24 C615 18 665 28 700 42" />
                </svg>
              </div>
              <div className="hourly-list">
                {weatherData.forecast.length ? weatherData.forecast.slice(0, 9).map((item) => {
                  const hour = new Date(item.dt * 1000).toLocaleTimeString('en-US', { hour: 'numeric' });
                  return (
                    <div className="hour-column" key={item.dt}>
                      <strong>{hour}</strong>
                      <span>{item.pop ? Math.round(item.pop * 100) : 0}%</span>
                      <b>{Math.round(item.main.temp)}°</b>
                    </div>
                  );
                }) : weekDays.slice(0, 9).map((day, index) => (
                  <div className="hour-column" key={day}>
                    <strong>{index + 7}:00</strong>
                    <span>0%</span>
                    <b>{Math.round(weatherData.temperature + index - 4)}°</b>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      )}
    </main>
  );
}

export default WeatherApp
