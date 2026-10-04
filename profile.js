const profileApi = "https://media2.edu.metropolia.fi/restaurant/api/v1";
const profileToken = localStorage.getItem("restaurant_user_token");
const profileUsername = localStorage.getItem("restaurant_username") || "";

const profileForm = document.querySelector("#profile-form");
const avatarForm = document.querySelector("#avatar-form");
const avatarFile = document.querySelector("#avatar-file");
const avatarImage = document.querySelector("#profile-avatar");
const profileMessage = document.querySelector("#profile-message");
const favoritesContainer = document.querySelector("#profile-favorites");
const favoritesCount = document.querySelector("#favorite-count");

if (!profileToken) {
    window.location.replace("index.html");
} else {

    populateFormInputs(profileUsername, localStorage.getItem("restaurant_email") || "");

    const savedAvatar = localStorage.getItem("restaurant_avatar");
    if (savedAvatar && avatarImage) {
        avatarImage.src = savedAvatar;
        avatarImage.hidden = false;
    }

    loadUserProfile();
    loadProfileFavorites();
}

function populateFormInputs(username, email) {
    if (!profileForm) return;

    const usernameInput = profileForm.querySelector('input[name="username"]') || 
                          profileForm.querySelector('input[name="käyttäjätunnus"]') || 
                          profileForm.elements[0];
                          
    const emailInput = profileForm.querySelector('input[type="email"]') || 
                       profileForm.querySelector('input[name="email"]') || 
                       profileForm.querySelector('input[name="sähköposti"]');

    if (usernameInput && username) usernameInput.value = username;
    if (emailInput) emailInput.value = email || "";
}


async function loadUserProfile() {
    try {
        const response = await fetch(`${profileApi}/users/token`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${profileToken}`
            }
        });

        if (!response.ok) {
            if (response.status === 403 || response.status === 401) {

                localStorage.removeItem("restaurant_user_token");
                window.location.replace("index.html");
                return;
            }
            throw new Error(`Server status ${response.status}`);
        }

        const user = await response.json();


        populateFormInputs(user.username, user.email);

        if (user.username) localStorage.setItem("restaurant_username", user.username);
        if (user.email) localStorage.setItem("restaurant_email", user.email);

        if (user.avatar && avatarImage) {
            const avatarUrl = user.avatar.startsWith("http") 
                ? user.avatar 
                : `${profileApi.replace('/api/v1', '')}/uploads/${user.avatar}`;
                
            avatarImage.src = avatarUrl;
            avatarImage.hidden = false;
            localStorage.setItem("restaurant_avatar", avatarUrl);
        }

    } catch (error) {
        console.warn("Could not fetch user profile from API, using cached data:", error.message);
    }
}


if (avatarForm) {
    avatarForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        
        const file = avatarFile?.files[0];
        if (!file || !file.type.startsWith("image/")) {
            if (profileMessage) profileMessage.textContent = typeof translate === "function" ? translate("Choose an image file first.") : "Choose an image file first.";
            return;
        }

        const submitButton = avatarForm.querySelector("[type='submit']");
        if (submitButton) submitButton.disabled = true;
        if (profileMessage) profileMessage.textContent = typeof translate === "function" ? translate("Uploading your picture…") : "Uploading your picture…";

        const formData = new FormData();
        formData.append("avatar", file);

        try {
            const response = await fetch(`${profileApi}/users/avatar`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${profileToken}`
                },
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || data.message || "Avatar upload failed.");
            }

            // Read returned avatar filename/path from response: { data: { avatar: "filename.jpg" } }
            const uploadedFilename = data.data?.avatar || data.avatar;
            const fullAvatarUrl = uploadedFilename?.startsWith("http")
                ? uploadedFilename
                : `${profileApi.replace('/api/v1', '')}/uploads/${uploadedFilename}`;

            localStorage.setItem("restaurant_avatar", fullAvatarUrl);
            
            if (avatarImage) {
                avatarImage.src = fullAvatarUrl;
                avatarImage.hidden = false;
            }

            if (profileMessage) profileMessage.textContent = typeof translate === "function" ? translate("Your profile picture has been saved.") : "Your profile picture has been saved.";

        } catch (error) {
            if (profileMessage) profileMessage.textContent = error.message;
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
}

function getProfileFavoriteStorageKey(username = profileUsername) {
    return `favorite_restaurants:${username.trim().toLowerCase()}`;
}

function readProfileFavorites(username = profileUsername) {
    try {
        return JSON.parse(localStorage.getItem(getProfileFavoriteStorageKey(username)) || "[]");
    } catch {
        return [];
    }
}

function getProfileRestaurantKey(restaurant) {
    return restaurant._id || restaurant.id || restaurant.name;
}

function setProfileFavorites(favorites, username = profileUsername) {
    localStorage.setItem(getProfileFavoriteStorageKey(username), JSON.stringify(favorites));
}

async function loadProfileFavorites() {
    const favorites = readProfileFavorites();
    if (favoritesCount) favoritesCount.textContent = "0";
    if (favorites.length === 0) {
        showNoFavorites();
        return;
    }

    if (favoritesContainer) {
        favoritesContainer.innerHTML = `<p class="profile-empty-state">${typeof translate === "function" ? translate("Loading your favorites…") : "Loading your favorites…"}</p>`;
    }

    try {
        const response = await fetch(`${profileApi}/restaurants`);
        if (!response.ok) throw new Error(`Could not load restaurants (${response.status}).`);
        const restaurants = await response.json();
        const savedRestaurants = [];
        const currentFavorites = [];

        for (const restaurant of restaurants) {
            const currentKey = getProfileRestaurantKey(restaurant);
            const id = restaurant._id || restaurant.id || restaurant.restaurant_id || restaurant.restaurantId;
            const oldIdKey = id ? `id:${id}` : "";
            const oldNameKey = `name:${[restaurant.name, restaurant.city, restaurant.address].filter(Boolean).join("|").toLowerCase()}`;

            if (favorites.includes(currentKey) || favorites.includes(oldIdKey) || favorites.includes(oldNameKey)) {
                savedRestaurants.push(restaurant);
                if (!currentFavorites.includes(currentKey)) currentFavorites.push(currentKey);
            }
        }

        setProfileFavorites(currentFavorites);
        if (currentFavorites.length === 0) {
            showNoFavorites();
            return;
        }
        renderFavoriteRestaurants(savedRestaurants, currentFavorites);
    } catch (error) {
        if (favoritesContainer) {
            favoritesContainer.replaceChildren();
            const message = document.createElement("p");
            message.className = "profile-empty-state";
            message.textContent = `${typeof translate === "function" ? translate("Could not load your favorite restaurants.") : "Could not load your favorite restaurants."} ${error.message}`;
            favoritesContainer.appendChild(message);
        }
    }
}

function showNoFavorites() {
    if (!favoritesContainer) return;
    favoritesContainer.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "profile-empty-state";
    empty.append(typeof translate === "function" ? translate("You have not saved any restaurants yet. ") : "You have not saved any restaurants yet. ");
    const link = document.createElement("a");
    link.href = "index.html#restaurants";
    link.textContent = typeof translate === "function" ? translate("Browse restaurants") : "Browse restaurants";
    empty.appendChild(link);
    favoritesContainer.appendChild(empty);
}

function renderFavoriteRestaurants(restaurants, favorites) {
    if (!favoritesContainer) return;
    favoritesContainer.replaceChildren();
    if (favoritesCount) favoritesCount.textContent = favorites.length;
    
    if (!restaurants.length) {
        if (favoritesCount) favoritesCount.textContent = "0";
        showNoFavorites();
        return;
    }

    for (const restaurant of restaurants) {
        const item = document.createElement("article");
        item.className = "profile-favorite-item";
        
        const details = document.createElement("div");
        const name = document.createElement("h3");
        name.textContent = restaurant.name || (typeof translate === "function" ? translate("Restaurant") : "Restaurant");
        details.appendChild(name);

        const descriptionParts = [];
        if (restaurant.city) descriptionParts.push(restaurant.city);
        if (restaurant.address) descriptionParts.push(restaurant.address);
        
        if (descriptionParts.length > 0) {
            const location = document.createElement("p");
            location.textContent = descriptionParts.join(" · ");
            details.appendChild(location);
        }
        item.appendChild(details);

        const actions = document.createElement("div");
        actions.className = "profile-favorite-actions";
        
        const browseLink = document.createElement("a");
        const restaurantKey = getProfileRestaurantKey(restaurant);
        browseLink.href = `index.html?restaurant=${encodeURIComponent(restaurantKey)}#restaurants`;
        browseLink.textContent = typeof translate === "function" ? translate("Find a restaurant") : "Find a restaurant";
        actions.appendChild(browseLink);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "remove-favorite-button";
        removeButton.textContent = typeof translate === "function" ? translate("Remove") : "Remove";
        removeButton.addEventListener("click", () => {
            const favoriteIndex = favorites.indexOf(getProfileRestaurantKey(restaurant));
            if (favoriteIndex >= 0) favorites.splice(favoriteIndex, 1);
            setProfileFavorites(favorites);
            loadProfileFavorites();
        });

        actions.appendChild(removeButton);
        item.appendChild(actions);
        favoritesContainer.appendChild(item);
    }
}


const logoutBtn = document.querySelector("#profile-logout");
if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        for (const key of ["restaurant_user_token", "restaurant_username", "restaurant_email", "restaurant_avatar"]) {
            localStorage.removeItem(key);
        }
        window.location.href = "index.html";
    });
}