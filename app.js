const restaurant_api = "https://media2.edu.metropolia.fi/restaurant/api/v1";

for (const key of ["restaurant_user_token", "restaurant_username", "restaurant_email"]) {
    const oldValue = sessionStorage.getItem(key);
    if (!localStorage.getItem(key) && oldValue) {
        localStorage.setItem(key, oldValue);
    }
}
let restaurants = [];
let userLocation = null;
let selectedRestaurant = null;
let selectedMenuType = "daily";
let renderedWeekDays = [];
let usedWeekdayFallback = false;
let restaurantMap = null;
let restaurantMarkers = null;
let mapMarkerByRestaurant = new Map();
let focusedMapRestaurant = null;
let matchingRestaurants = [];
let nearestRestaurant = null;
let favoriteRestaurantKeys = [];
let favoriteStorageKey = null;

function loadFavoritesForCurrentUser() {
    const token = localStorage.getItem("restaurant_user_token");
    const username = localStorage.getItem("restaurant_username");
    favoriteStorageKey = token && username
        ? `favorite_restaurants:${username.trim().toLowerCase()}`
        : null;
    favoriteRestaurantKeys = [];
    if (!favoriteStorageKey) return;

    try {
        const savedFavorites = JSON.parse(localStorage.getItem(favoriteStorageKey) || "[]");
        favoriteRestaurantKeys = savedFavorites;
    } catch {
        favoriteRestaurantKeys = [];
    }
}
loadFavoritesForCurrentUser();

window.addEventListener("restaurant-auth-changed", (event) => {
    const previousUsername = event.detail?.previousUsername;
    const username = event.detail?.username;
    if (previousUsername && username && previousUsername !== username) {
        const previousKey = `favorite_restaurants:${previousUsername.trim().toLowerCase()}`;
        const nextKey = `favorite_restaurants:${username.trim().toLowerCase()}`;
        const previousFavorites = localStorage.getItem(previousKey);
        if (previousFavorites && !localStorage.getItem(nextKey)) {
            localStorage.setItem(nextKey, previousFavorites);
        }
    }
    loadFavoritesForCurrentUser();
    if (document.querySelector("#favorites-only").checked && !favoriteStorageKey) {
        document.querySelector("#favorites-only").checked = false;
    }
    if (selectedRestaurant) showRestaurantDetails(selectedRestaurant);
    showRestaurants(searchInput.value);
});

function getRestaurantFavoriteKey(restaurant) {
    return restaurant._id || restaurant.id || restaurant.name;
}

function migrateFavoriteKeys() {
    if (!favoriteStorageKey || restaurants.length === 0) return;

    const updatedFavorites = [];
    for (const restaurant of restaurants) {
        const currentKey = getRestaurantFavoriteKey(restaurant);
        const id = restaurant._id || restaurant.id || restaurant.restaurant_id || restaurant.restaurantId;
        const oldIdKey = id ? `id:${id}` : "";
        const oldNameKey = `name:${[restaurant.name, restaurant.city, restaurant.address].filter((value) => value).join("|").toLowerCase()}`;

        if (favoriteRestaurantKeys.includes(currentKey)
            || favoriteRestaurantKeys.includes(oldIdKey)
            || favoriteRestaurantKeys.includes(oldNameKey)) {
            if (!updatedFavorites.includes(currentKey)) updatedFavorites.push(currentKey);
        }
    }

    favoriteRestaurantKeys = updatedFavorites;
    localStorage.setItem(favoriteStorageKey, JSON.stringify(favoriteRestaurantKeys));
}

function isFavoriteRestaurant(restaurant) {
    if (!favoriteStorageKey) return false;
    return favoriteRestaurantKeys.includes(getRestaurantFavoriteKey(restaurant));
}

function createFavoriteButton(restaurant) {
    const favorite = isFavoriteRestaurant(restaurant);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `favorite-button${favorite ? " is-favorite" : ""}`;
    const canSave = favoriteStorageKey !== null;
    button.title = canSave
        ? (favorite ? "Remove from favorites" : "Add to favorites")
        : "Sign in to save favorites";
    button.textContent = favorite ? "\u2665" : "\u2661";
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!favoriteStorageKey) {
            requestFavoriteSignIn();
            return;
        }
        toggleFavoriteRestaurant(restaurant);
    });
    return button;
}

function requestFavoriteSignIn() {
    document.querySelector("#open-login").click();
    window.setTimeout(() => {
        const message = document.querySelector("#auth-message");
        if (message) message.textContent = translate("Please sign in to save favorite restaurants.");
    }, 0);
}

function toggleFavoriteRestaurant(restaurant) {
    if (!favoriteStorageKey) {
        requestFavoriteSignIn();
        return;
    }
    const pageScrollPosition = window.scrollY;
    const key = getRestaurantFavoriteKey(restaurant);
    const favoriteIndex = favoriteRestaurantKeys.indexOf(key);
    if (favoriteIndex >= 0) favoriteRestaurantKeys.splice(favoriteIndex, 1);
    else favoriteRestaurantKeys.push(key);
    localStorage.setItem(favoriteStorageKey, JSON.stringify(favoriteRestaurantKeys));
    if (selectedRestaurant) showRestaurantDetails(selectedRestaurant);
    showRestaurants(searchInput.value);
    requestAnimationFrame(() => window.scrollTo(0, pageScrollPosition));
}

async function fetchRestaurants() {
    try {
        const req = await fetch(`${restaurant_api}/restaurants`);
        if (!req.ok) {
            throw new Error(`HTTP error! Status: ${req.status}`);
        }
        return req.json();
    } catch (error) {
        console.log("Caught Error", error.message);
        return [];
    }
}

async function fetchMenu(id, menuType, language) {
    try {
        const req = await fetch(`${restaurant_api}/restaurants/${menuType}/${id}/${language}`);
        if (!req.ok) {
            throw new Error(`HTTP error! Status: ${req.status}`);
        }
        return await req.json();
    } catch (error) {
        console.log("Could not load menu:", error.message);
        return null;
    }
}

function selectRestaurant(restaurant) {
    selectedRestaurant = restaurant;
    document.querySelector("#menu-panel").hidden = false;
    showRestaurantDetails(restaurant);
    showMenu();
    document.querySelector("#menu-results").scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}

window.addEventListener("language-change", () => {
    if (selectedRestaurant) {
        showRestaurantDetails(selectedRestaurant);
        showMenu();
    }
    showRestaurants(searchInput.value);
});

function hasMenuContent(menu) {
    if (!menu) return false;
    if (typeof menu === "string") return menu.trim().length > 0;
    if (menu.length >= 0) return menu.some(hasMenuContent);
    if (typeof menu !== "object") return false;
    if (menu.data !== undefined) return hasMenuContent(menu.data);

    const menuKeys = [
        "days", "courses", "course", "meals", "meal",
        "dishes", "dish", "items", "item", "food", "foods", "menu", "menus",
        "daily", "weekly", "breakfast", "lunch", "dinner", "monday", "tuesday",
        "wednesday", "thursday", "friday", "saturday", "sunday"
    ];
    for (const key of menuKeys) {
        if (menu[key] !== undefined && hasMenuContent(menu[key])) return true;
    }

    const dishName = menu.name || menu.dish || menu.food || menu.title;
    const dishFields = [
        "name", "dish", "food", "title", "price", "diets", "diet", "allergens",
        "category", "coursetype", "course_type", "tags", "id", "_id", "restaurantid"
    ];
    if (!dishName) return false;
    for (const key in menu) {
        if (isRestaurantIdField(key)) continue;
        if (!dishFields.includes(key.toLowerCase())) return false;
    }
    return true;
}

// 1. Simple function to check if a property key is an ID
function isRestaurantIdField(key) {
    const lowerKey = key.toLowerCase();
    
    if (lowerKey === "id") return true;
    if (lowerKey.endsWith("_id")) return true;
    if (lowerKey.endsWith("id")) return true;

    return false;
}

function formatRestaurantFieldName(key) {
    if (key.toLowerCase() === "company") {
        return translate("Service provider");
    }
    let result = "";
    for (let i = 0; i < key.length; i++) {
        const char = key[i];
        if (char >= "A" && char <= "Z" && i > 0) {
            result += " ";
        }
        if (char === "_" || char === "-") {
            result += " ";
        } else {
            result += char;
        }
    }


    const formatted = result.charAt(0).toUpperCase() + result.slice(1);
    return translate(formatted);
}
function collectRestaurantFields(restaurantData) {
    const fields = [];

    if (!restaurantData) return fields;

    const hiddenKeys = ["id", "_id", "__v", "coordinates", "latitude", "longitude", "lat", "lng", "lon", "name"];

    for (const key in restaurantData) {
        const lowerKey = key.toLowerCase();
        const value = restaurantData[key];

        if (hiddenKeys.includes(lowerKey) || isRestaurantIdField(key)) continue;
        if (value === null || value === undefined || value === "") continue;

        const label = formatRestaurantFieldName(key);

        if (typeof value === "boolean") {
            const displayValue = value ? translate("Yes") : translate("No");
            fields.push({ label: label, value: displayValue, key: lowerKey });
        } 
        // Handle normal text/number values
        else if (typeof value === "string" || typeof value === "number") {
            fields.push({ label: label, value: String(value).trim(), key: lowerKey });
        }
    }

    return fields;
}

function showRestaurantDetails(restaurant) {
    const panel = document.querySelector("#restaurant-details");
    panel.replaceChildren();

    const heading = document.createElement("h2");
    heading.textContent = restaurant.name || translate("Restaurant details");
    panel.appendChild(heading);
    panel.appendChild(createFavoriteButton(restaurant));

    const fields = collectRestaurantFields(restaurant);
    const hasPhoneNumber = fields.some((field) =>
        field.key.includes("phone") || field.key.includes("telephone") || field.key.includes("mobile")
    );
    if (!hasPhoneNumber) {
        fields.push({ label: translate("Phone"), value: translate("Phone number unavailable"), key: "phone" });
    }
    const coordinates = getRestaurantCoordinates(restaurant);
    if (userLocation && coordinates) {
        fields.push({
            label: translate("Distance"),
            value: `${getDistance(userLocation.latitude, userLocation.longitude, coordinates[0], coordinates[1])} km`,
            key: "distance"
        });
    }

    for (const field of fields) {
        const row = document.createElement("div");
        row.className = "restaurant-detail-row";
        const label = document.createElement("span");
        label.className = "restaurant-detail-label";
        label.textContent = field.label;
        const value = document.createElement("span");
        value.className = "restaurant-detail-value";

        if (field.key.includes("email")) {
            const link = document.createElement("a");
            link.href = `mailto:${field.value}`;
            link.textContent = field.value;
            value.appendChild(link);
        } else if (field.key.includes("phone") || field.key.includes("telephone") || field.key.includes("mobile")) {
            const link = document.createElement("a");
            link.href = `tel:${field.value.replace(/[^+\d]/g, "")}`;
            link.textContent = field.value;
            value.appendChild(link);
        } else if (field.key.includes("website") || field.key === "url" || field.key.includes("homepage")) {
            try {
                const url = new URL(field.value, location.href);
                if (url.protocol === "http:" || url.protocol === "https:") {
                    const link = document.createElement("a");
                    link.href = url.href;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.textContent = field.value;
                    value.appendChild(link);
                } else {
                    value.textContent = field.value;
                }
            } catch {
                value.textContent = field.value;
            }
        } else {
            value.textContent = field.value;
        }
        row.append(label, value);
        panel.appendChild(row);
    }

    if (coordinates) {
        const mapButton = document.createElement("button");
        mapButton.type = "button";
        mapButton.className = "restaurant-map-link";
        mapButton.textContent = translate("Show on map");
        mapButton.addEventListener("click", () => {
            focusedMapRestaurant = restaurant;
            setRestaurantView("map");
        });
        panel.appendChild(mapButton);

        const mapLink = document.createElement("a");
        mapLink.className = "restaurant-website-link";
        mapLink.href = `https://www.google.com/maps/dir/?api=1&destination=${coordinates[0]},${coordinates[1]}`;
        mapLink.target = "_blank";
        mapLink.rel = "noopener noreferrer";
        mapLink.textContent = translate("Open in Google Maps");
        panel.appendChild(mapLink);
    }
}
function showMenu() {
    const result = document.querySelector("#menu-results");
    result.innerHTML = "";

    if (!selectedRestaurant) {
        result.textContent = "";
        const message = document.createElement("p");
        message.className = "placeholder-box";
        message.textContent = translate("Select a restaurant to see its menu.");
        result.appendChild(message);
        return;
    }
    const restaurantId = selectedRestaurant._id


    if (!restaurantId) {
        result.textContent = "";
        const message = document.createElement("p");
        message.className = "placeholder-box";
        message.textContent = translate("A menu is not available for this restaurant.");
        result.appendChild(message);
        return;
    }

    const restaurant = selectedRestaurant;
    const menuType = selectedMenuType;
    const requestedLanguage = getLanguage();

    const heading = document.createElement("h2");
    heading.className = "menu-heading";
    const menuLabel = selectedMenuType === "daily"
        ? `${translate("Daily menu")} - ${new Intl.DateTimeFormat(getLanguage() === "fi" ? "fi-FI" : "en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long"
        }).format(new Date())}`
        : translate("Weekly menu");
    heading.textContent = `${selectedRestaurant.name} - ${menuLabel}`;
    const loading = document.createElement("p");
    loading.className = "placeholder-box";
    loading.textContent = translate("Loading menu...");
    result.append(heading, loading);

    fetchMenu(restaurantId, selectedMenuType, requestedLanguage).then((menu) => {
        if (selectedRestaurant !== restaurant || selectedMenuType !== menuType || getLanguage() !== requestedLanguage) return;
        result.innerHTML = "";
        result.appendChild(heading);

        if (!menu) {
            const message = document.createElement("p");
            message.className = "placeholder-box";
            message.textContent = translate("Could not load this menu. Please try again.");
            result.appendChild(message);
            return;
        }

        if (!hasMenuContent(menu)) {
            const message = document.createElement("p");
            message.className = "placeholder-box";
            message.textContent = translate("No menu available for this restaurant.");
            result.appendChild(message);
            return;
        }

        renderedWeekDays = [];
        usedWeekdayFallback = false;
        addMenuItems(menu, result);
        if (selectedMenuType === "weekly" && usedWeekdayFallback) {
            const message = document.createElement("p");
            message.className = "weekly-menu-notice";
            message.textContent = translate("The API repeated one date for all five entries; they are shown as Monday through Friday.");
            result.appendChild(message);
        } else if (selectedMenuType === "weekly" && renderedWeekDays.length === 1) {
            const message = document.createElement("p");
            message.className = "weekly-menu-notice";
            message.textContent = `${translate("Only one day was included in the weekly menu data: ")}${renderedWeekDays[0]}.`;
            result.appendChild(message);
        }
        if (selectedMenuType === "weekly") {
            addWeeklyDayCounts(result);
        }
    });
}

function addWeeklyDayCounts(container) {
    for (const group of container.querySelectorAll(".menu-day-group")) {
        const count = group.querySelectorAll(":scope > .menu-day-content .menu-item").length;
        const badge = document.createElement("span");
        badge.className = "menu-day-count";
        badge.textContent = `${count} ${translate(count === 1 ? "dish" : "dishes")}`;
        group.querySelector("summary").appendChild(badge);
    }
}

function getCourseCategory(course) {
    const dishName = course.name || course.dish || course.food || course.title || "";
    const dietaryInfo = `${course.diets || ""} ${course.diet || ""} ${course.tags || ""}`;
    if (/^\s*veg\s*:/i.test(dishName)
        || /\b(vegan|vegetarian|veg)\b/i.test(`${dishName} ${dietaryInfo}`)) {
        return translate("Vegetarian options");
    }

    const category = course.category || course.courseType || course.course_type
        || course.menuCategory || course.section;
    if (typeof category === "string" && category.trim()) {
        return translate(category.trim().replace(/[_-]+/g, " "));
    }
    if (category && typeof category === "object") {
        const label = category.name || category.title || category.label;
        if (label) return translate(`${label}`.trim());
    }
    return translate("Other dishes");
}

function addCategorizedCourses(courses, container) {
    const categories = new Map();
    for (const course of courses) {
        const category = getCourseCategory(course);
        if (!categories.has(category)) categories.set(category, []);
        categories.get(category).push(course);
    }

    const categoryNames = [...categories.keys()].sort((a, b) => {
        if (a === translate("Vegetarian options")) return -1;
        if (b === translate("Vegetarian options")) return 1;
        if (a === translate("Other dishes")) return 1;
        if (b === translate("Other dishes")) return -1;
        return a.localeCompare(b);
    });

    for (let index = 0; index < categoryNames.length; index++) {
        const category = categoryNames[index];
        const items = categories.get(category);
        const group = document.createElement("details");
        group.className = "menu-category-group";
        group.open = index === 0;
        const summary = document.createElement("summary");
        summary.textContent = category;
        const count = document.createElement("span");
        count.className = "menu-day-count";
        count.textContent = `${items.length} ${translate(items.length === 1 ? "dish" : "dishes")}`;
        summary.appendChild(count);
        const content = document.createElement("div");
        content.className = "menu-category-content";
        group.append(summary, content);
        container.appendChild(group);
        for (const item of items) addMenuItems(item, content, true);
    }
}

function addMenuItems(menu, container, insideDay = false) {
    if (menu && menu.data) menu = menu.data;

    if (typeof menu === "string") {
        const line = document.createElement("p");
        line.className = "menu-item";
        line.textContent = menu;
        container.appendChild(line);
        return;
    }

    if (menu && menu.length >= 0) {
        if (menu.length === 0) {
            const message = document.createElement("p");
            message.className = "placeholder-box";
            message.textContent = translate("No menu items are available.");
            container.appendChild(message);
            return;
        }
    const weekdays = getLanguage() === "fi"
        ? ["Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai", "Sunnuntai"]
        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        const apiDayLabels = menu.map((item) => item && typeof item === "object"
            ? item.day || item.weekday || item.date
            : null);
        const repeatedDateForWorkweek = menu.length === 5
            && apiDayLabels.every((day) => day && `${day}` === `${apiDayLabels[0]}`);
        if (selectedMenuType === "weekly" && repeatedDateForWorkweek && !insideDay) {
            usedWeekdayFallback = true;
        }
        const weeklyDayGroups = new Map();
        for (let index = 0; index < menu.length; index++) {
            const item = menu[index];
            const day = repeatedDateForWorkweek
                ? weekdays[index]
                : apiDayLabels[index];

            if (selectedMenuType === "weekly" && day && !insideDay) {
                const dayLabel = `${day}`;
                if (!renderedWeekDays.includes(dayLabel)) renderedWeekDays.push(dayLabel);
                let dayContent = weeklyDayGroups.get(dayLabel);
                if (!dayContent) {
                    const dayGroup = document.createElement("details");
                    dayGroup.className = "menu-day-group";

                    const summary = document.createElement("summary");
                    summary.textContent = dayLabel;
                    dayContent = document.createElement("div");
                    dayContent.className = "menu-day-content";
                    dayGroup.append(summary, dayContent);
                    container.appendChild(dayGroup);
                    weeklyDayGroups.set(dayLabel, dayContent);
                }
                addMenuItems(item, dayContent, true);
            } else {
                addMenuItems(item, container, insideDay);
            }
        }
        return;
    }

    if (!menu || typeof menu !== "object") return;

    const day = menu.day || menu.weekday || menu.date;
    if (day && selectedMenuType !== "weekly") {
        const dayHeading = document.createElement("h3");
        dayHeading.className = "menu-day";
        dayHeading.textContent = day;
        container.appendChild(dayHeading);
    }

    const rawItemName = menu.name || menu.dish || menu.food || menu.title;
    const itemName = typeof rawItemName === "string"
        ? rawItemName.replace(/^\s*veg\s*:\s*/i, "")
        : rawItemName;
    if (itemName) {
        const item = document.createElement("div");
        item.className = "menu-item";
        const name = document.createElement("strong");
        name.textContent = itemName;
        item.appendChild(name);

        const details = [];
        if (menu.price) details.push(menu.price);
        if (menu.diets) details.push(menu.diets.join ? menu.diets.join(", ") : menu.diets);
        if (menu.allergens) details.push(menu.allergens.join ? menu.allergens.join(", ") : menu.allergens);
        if (details.length) {
            const detail = document.createElement("span");
            detail.className = "menu-detail";
            detail.textContent = details.join(" · ");
            item.appendChild(detail);
        }
        container.appendChild(item);
    }

    const childKeys = ["days", "menu", "menus", "daily", "weekly", "courses", "course", "meals", "meal", "dishes", "items", "food"];
    let foundItems = false;
    for (const key of childKeys) {
        if (menu[key]) {
            foundItems = true;
            if (key === "courses" && menu[key].length >= 0) {
                addCategorizedCourses(menu[key], container);
            } else {
                addMenuItems(menu[key], container, insideDay);
            }
        }
    }

    if (!itemName && !foundItems) {
        for (const key in menu) {
            if (typeof menu[key] === "object" && menu[key] !== null) {
                let sectionContent = container;
                if (selectedMenuType === "weekly" && !insideDay) {
                    if (!renderedWeekDays.includes(key)) renderedWeekDays.push(key);
                    const dayGroup = document.createElement("details");
                    dayGroup.className = "menu-day-group";
                    const summary = document.createElement("summary");
                    summary.textContent = key;
                    sectionContent = document.createElement("div");
                    sectionContent.className = "menu-day-content";
                    dayGroup.append(summary, sectionContent);
                    container.appendChild(dayGroup);
                } else {
                    const section = document.createElement("h3");
                    section.className = "menu-day";
                    section.textContent = key;
                    container.appendChild(section);
                }
                foundItems = true;
                addMenuItems(menu[key], sectionContent, true);
            }
        }
    }

    if (!itemName && !foundItems) {
        const message = document.createElement("p");
        message.className = "placeholder-box";
        message.textContent = translate("No menu items are available.");
        container.appendChild(message);
    }
}

function getDistance(lat1, lon1, lat2, lon2) {
    const avgLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
    const latdeg = (lat1 - lat2) * 110.574;
    const longdet = (lon1 - lon2) * 111.320 * Math.cos(avgLat);
    const distance = Math.sqrt(latdeg ** 2 + longdet ** 2);
    return Math.round(distance * 10) / 10;
}

function restaurantlistmaker(restaurant, container) {
    const row = document.createElement("div");
    row.className = "station-row";
    row.dataset.restaurantKey = getRestaurantFavoriteKey(restaurant);
    if (restaurant === nearestRestaurant) row.classList.add("nearest-restaurant");
    row.addEventListener("click", function (event) {
        if (event.target.closest("button")) return;
        selectRestaurant(restaurant);
    });

    const name = document.createElement("span");
    name.className = "station-name";
    name.textContent = restaurant.name;
    row.appendChild(name);
    row.appendChild(createFavoriteButton(restaurant));

    if (restaurant === nearestRestaurant) {
        const nearestBadge = document.createElement("span");
        nearestBadge.className = "nearest-badge";
        nearestBadge.textContent = translate("Nearest");
        row.appendChild(nearestBadge);
    }

    const coordinates = getRestaurantCoordinates(restaurant);
    if (userLocation && coordinates) {
        const distance = getDistance(
            userLocation.latitude,
            userLocation.longitude,
            coordinates[0],
            coordinates[1]
        );
        const distanceText = document.createElement("span");
        distanceText.className = "station-dist";
        distanceText.textContent = `${distance} km`;
        row.appendChild(distanceText);
    }

    container.appendChild(row);
}

function focusRestaurantFromLink() {
    const queryParts = window.location.search.substring(1).split("&");
    let restaurantKey = "";
    for (const part of queryParts) {
        const value = part.split("=");
        if (value[0] === "restaurant") {
            restaurantKey = decodeURIComponent(value[1] || "");
            break;
        }
    }
    if (!restaurantKey) return;

    const restaurantRows = document.querySelectorAll(".station-row");
    let row = null;
    for (const restaurantRow of restaurantRows) {
        if (restaurantRow.dataset.restaurantKey === restaurantKey) {
            row = restaurantRow;
            break;
        }
    }
    if (!row) return;

    row.classList.add("restaurant-link-target");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => row.classList.remove("restaurant-link-target"), 2600);
    window.history.replaceState(null, "", "index.html#restaurants");
}

function getProviderName(restaurant) {
    const provider = restaurant.company || restaurant.provider || restaurant.operator
        || restaurant.service_provider || restaurant.serviceProvider;
    if (typeof provider === "string") return provider.trim() || translate("Other");
    if (provider && typeof provider === "object") {
        return `${provider.name || provider.company || provider.title || translate("Other")}`.trim();
    }
    return translate("Other");
}

function populateRestaurantFilters() {
    const cities = [];
    const providers = [];
    for (const restaurant of restaurants) {
        const city = restaurant.city || "Other";
        const provider = getProviderName(restaurant);
        if (!cities.includes(city)) cities.push(city);
        if (!providers.includes(provider)) providers.push(provider);
    }
    cities.sort((a, b) => a.localeCompare(b));
    providers.sort((a, b) => a.localeCompare(b));

    for (const [id, values, defaultLabel] of [
        ["city-filter", cities, translate("All cities")],
        ["provider-filter", providers, translate("All providers")]
    ]) {
        const select = document.querySelector(`#${id}`);
        select.innerHTML = "";

        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = defaultLabel;
        select.appendChild(defaultOption);

        for (const value of values) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        }
    }
}

function getRestaurantCoordinates(restaurant) {
    const coordinates = restaurant.location?.coordinates;
    if (coordinates && coordinates.join && coordinates.length >= 2) {
        const longitude = parseFloat(coordinates[0]);
        const latitude = parseFloat(coordinates[1]);
        if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
            return [latitude, longitude];
        }
    }
    const latitude = parseFloat(restaurant.latitude ?? restaurant.lat);
    const longitude = parseFloat(restaurant.longitude ?? restaurant.lng ?? restaurant.lon);
    if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
        return [latitude, longitude];
    }
    return null;
}

function updateRestaurantMap(results = matchingRestaurants) {
    if (!restaurantMap || !restaurantMarkers) return;
    restaurantMarkers.clearLayers();
    mapMarkerByRestaurant = new Map();
    const located = results
        .map((restaurant) => ({ restaurant, coordinates: getRestaurantCoordinates(restaurant) }))
        .filter((item) => item.coordinates);
    const coordinateGroups = new Map();
    for (const item of located) {
        const key = item.coordinates.join(",");
        if (!coordinateGroups.has(key)) coordinateGroups.set(key, []);
        coordinateGroups.get(key).push(item);
    }
    for (const group of coordinateGroups.values()) {
        group.forEach((item, index) => {
            item.displayCoordinates = item.coordinates;
            item.labelDirection = "top";
            if (group.length < 2) return;

            const angle = (2 * Math.PI * index) / group.length;
            const offsetMeters = 14;
            const latitudeOffset = (Math.sin(angle) * offsetMeters) / 111320;
            const longitudeScale = 111320 * Math.cos((item.coordinates[0] * Math.PI) / 180);
            const longitudeOffset = (Math.cos(angle) * offsetMeters) / longitudeScale;
            item.displayCoordinates = [
                item.coordinates[0] + latitudeOffset,
                item.coordinates[1] + longitudeOffset
            ];
            item.labelDirection = ["top", "bottom", "left", "right"][index % 4];
        });
    }
    const status = document.querySelector("#map-status");
    const userCoordinates = userLocation
        ? [userLocation.latitude, userLocation.longitude]
        : null;
    const hasUserPosition = userLocation !== null;
    status.textContent = located.length
            ? `${translate("Showing")} ${located.length} ${translate("of")} ${results.length} ${translate("matching restaurants with a location.")}${hasUserPosition ? ` ${translate("Blue dot: your position. Gold marker: nearest restaurant.")}` : ` ${translate("Enable location access to see your position and nearest restaurant.")}`}`
        : hasUserPosition
            ? translate("Your position is shown, but no matching restaurants have map locations.")
            : translate("No matching restaurants have map locations.");

    const bounds = [];
    let closest = null;
    if (hasUserPosition) {
        const userMarker = L.circleMarker(userCoordinates, {
            radius: 9,
            color: "#ffffff",
            weight: 3,
            fillColor: "#3b82f6",
            fillOpacity: 1,
            pane: "markerPane"
        }).bindPopup(translate("Your position"));
        userMarker.addTo(restaurantMarkers);
        bounds.push(userCoordinates);
        for (const item of located) {
            const distance = getDistance(
                userCoordinates[0], userCoordinates[1],
                item.coordinates[0], item.coordinates[1]
            );
            if (!closest || distance < closest.distance) closest = { ...item, distance };
        }
    }

    for (const { restaurant, coordinates, displayCoordinates, labelDirection } of located) {
        const isNearest = closest && restaurant === closest.restaurant;
        const isFocused = restaurant === focusedMapRestaurant;
        const marker = L.circleMarker(displayCoordinates, {
            radius: isFocused ? 13 : isNearest ? 10 : 7,
            color: isFocused ? "#ffffff" : isNearest ? "#fff1c2" : "#ffffff",
            weight: isFocused ? 4 : isNearest ? 3 : 2,
            fillColor: isFocused ? "#d9534f" : isNearest ? "#d49b31" : "#178582",
            fillOpacity: 1,
            title: restaurant.name || "Restaurant"
        });
        const popup = document.createElement("div");
        popup.className = "map-popup";
        const name = document.createElement("strong");
        name.textContent = `${restaurant.name || translate("Restaurant")}${isNearest ? ` (${translate("Nearest to you")})` : ""}`;
        popup.appendChild(name);
        const mapLabel = document.createElement("span");
        mapLabel.textContent = restaurant.name || translate("Restaurant");
        marker.bindTooltip(mapLabel, {
            permanent: true,
            direction: labelDirection,
            offset: labelDirection === "right" ? [8, 0]
                : labelDirection === "bottom" ? [0, 8]
                    : labelDirection === "left" ? [-8, 0] : [0, -8],
            className: `map-restaurant-label${isNearest ? " nearest" : ""}`
        });
        if (restaurant.address) {
            const address = document.createElement("p");
            address.textContent = restaurant.address;
            popup.appendChild(address);
        }
        const menuButton = document.createElement("button");
        menuButton.type = "button";
        menuButton.className = "map-menu-button";
        menuButton.textContent = translate("View menu");
        menuButton.addEventListener("click", () => selectRestaurant(restaurant));
        popup.appendChild(menuButton);
        marker.bindPopup(popup).addTo(restaurantMarkers);
        mapMarkerByRestaurant.set(restaurant, marker);
        bounds.push(displayCoordinates);
    }

    if (bounds.length > 1) {
        restaurantMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
    } else if (bounds.length === 1) {
        restaurantMap.setView(bounds[0], 14);
    } else {
        restaurantMap.setView([60.1699, 24.9384], 6);
    }

    const focusedMarker = mapMarkerByRestaurant.get(focusedMapRestaurant);
    if (focusedMarker) {
        restaurantMap.setView(focusedMarker.getLatLng(), Math.max(restaurantMap.getZoom(), 16));
        focusedMarker.openPopup();
    }
}

function setRestaurantView(view) {
    const showingMap = view === "map";
    document.querySelector("#city-list").hidden = showingMap;
    document.querySelector("#restaurant-map").hidden = !showingMap;
    document.querySelector("#map-status").hidden = !showingMap;
    for (const button of document.querySelectorAll("[data-restaurant-view]")) {
        const active = button.dataset.restaurantView === view;
        button.classList.toggle("active", active);
    }

    if (!showingMap) {
        showRestaurants(searchInput.value);
        return;
    }
    const mapElement = document.querySelector("#restaurant-map");
    if (!window.L) {
        document.querySelector("#map-status").textContent = translate("The map library did not load. Check your internet connection and reload the page.");
        return;
    }
    if (!restaurantMap) {
        restaurantMap = L.map(mapElement).setView([60.1699, 24.9384], 6);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(restaurantMap);
        restaurantMarkers = L.layerGroup().addTo(restaurantMap);
    }
    requestAnimationFrame(() => {
        restaurantMap.invalidateSize();
        updateRestaurantMap();
    });
}

function showRestaurants(searchText = "") {
    const container = document.querySelector("#city-list");
    const search = searchText.toLowerCase().trim();
    const selectedCity = document.querySelector("#city-filter").value;
    const selectedProvider = document.querySelector("#provider-filter").value;
    const favoritesOnly = document.querySelector("#favorites-only").checked;
    const cityRestaurants = {};
    matchingRestaurants = [];
    let visibleCount = 0;

    for (const restaurant of restaurants) {
        const city = restaurant.city || "Other";
        const provider = getProviderName(restaurant);
        const matchesSearch = `${city} ${restaurant.name || ""} ${restaurant.address || ""} ${provider}`
            .toLowerCase()
            .includes(search);

        if (matchesSearch && (!selectedCity || city === selectedCity)
            && (!selectedProvider || provider === selectedProvider)
            && (!favoritesOnly || isFavoriteRestaurant(restaurant))) {
            if (!cityRestaurants[city]) {
                cityRestaurants[city] = [];
            }
            cityRestaurants[city].push(restaurant);
            matchingRestaurants.push(restaurant);
            visibleCount++;
        }
    }

    nearestRestaurant = null;
    if (userLocation) {
        let shortestDistance = Infinity;
        for (const restaurant of matchingRestaurants) {
            const coordinates = getRestaurantCoordinates(restaurant);
            if (!coordinates) continue;
            const distance = getDistance(
                userLocation.latitude,
                userLocation.longitude,
                coordinates[0],
                coordinates[1]
            );
            if (distance < shortestDistance) {
                shortestDistance = distance;
                nearestRestaurant = restaurant;
            }
        }
    }

    container.innerHTML = "";
    const cities = [];
    for (const city in cityRestaurants) {
        cityRestaurants[city].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        cities.push(city);
    }
    cities.sort((a, b) => a.localeCompare(b));
    document.querySelector("#restaurant-count").textContent = `${visibleCount} ${translate(visibleCount === 1 ? "restaurant" : "restaurants")}`;
    updateRestaurantMap();

    if (cities.length === 0) {
        container.textContent = translate("No restaurants found.");
        return;
    }

    const columnCount = getComputedStyle(container).gridTemplateColumns.split(" ").length;
    const columns = [];
    for (let i = 0; i < columnCount; i++) {
        const column = document.createElement("div");
        column.className = "city-column";
        columns.push(column);
        container.appendChild(column);
    }

    for (const city of cities) {
        const card = document.createElement("div");
        card.className = "filter-card";

        const header = document.createElement("div");
        header.className = "filter-header";

        const title = document.createElement("span");
        title.className = "filter-title";
        title.textContent = city;

        const count = document.createElement("span");
        count.className = "filter-count";
        const cityCount = cityRestaurants[city].length;
        count.textContent = `${cityCount} ${translate(cityCount === 1 ? "restaurant" : "restaurants")}`;

        header.appendChild(title);
        header.appendChild(count);
        card.appendChild(header);

        for (const restaurant of cityRestaurants[city]) {
            restaurantlistmaker(restaurant, card);
        }

        let shortestColumn = columns[0];
        for (const column of columns) {
            if (column.offsetHeight < shortestColumn.offsetHeight) shortestColumn = column;
        }
        shortestColumn.appendChild(card);
    }
}

async function main(coords = null) {
    userLocation = coords;
    restaurants = await fetchRestaurants();
    restaurants.sort((a, b) => (a.city || "").localeCompare(b.city || ""));
    migrateFavoriteKeys();
    populateRestaurantFilters();
    showRestaurants();
    focusRestaurantFromLink();
}

const searchInput = document.querySelector("#restaurant-search");
searchInput.addEventListener("input", function () {
    showRestaurants(searchInput.value);
});

for (const filter of document.querySelectorAll("#city-filter, #provider-filter")) {
    filter.addEventListener("change", () => showRestaurants(searchInput.value));
}
document.querySelector("#favorites-only").addEventListener("change", (event) => {
    if (event.target.checked && !favoriteStorageKey) {
        event.target.checked = false;
        requestFavoriteSignIn();
        return;
    }
    showRestaurants(searchInput.value);
});

document.querySelector("#restaurant-search-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#clear-filters").addEventListener("click", () => {
    searchInput.value = "";
    document.querySelector("#city-filter").value = "";
    document.querySelector("#provider-filter").value = "";
    document.querySelector("#favorites-only").checked = false;
    showRestaurants();
});
for (const button of document.querySelectorAll("[data-restaurant-view]")) {
    button.addEventListener("click", () => setRestaurantView(button.dataset.restaurantView));
}

const menuButtons = document.querySelectorAll(".view-btn");
for (const button of menuButtons) {
    button.addEventListener("click", function () {
        selectedMenuType = button.dataset.view;
        for (const menuButton of menuButtons) {
            menuButton.classList.toggle("active", menuButton === button);
        }
        showMenu();
    });
}

window.addEventListener("resize", function () {
    showRestaurants(searchInput.value);
});

if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            main(pos.coords);
        },
        function () {
            main();
        }
    );
} else {
    main();
}
