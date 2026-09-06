console.log("Nuestro cuartito está vivo 🌙");

const objects = {
  tv: {
    name: "Televisor",
    message: "📺 Encender el televisor",
  },

  sofa: {
    name: "Sofá",
    message: "🛋️ Sentarse en el sofá",
  },

  plant: {
    name: "Planta",
    message: "🪴 Observar la planta",
  },

  picture: {
    name: "Cuadro",
    message: "🖼️ Mirar el cuadro",
  },

  shelf: {
    name: "Estantería",
    message: "📚 Revisar la estantería",
  },
};

const interactiveElements = document.querySelectorAll(".interactive");

const interactionMessage = document.querySelector("#interaction-message");

function showMessage(message) {
  interactionMessage.textContent = message;

  interactionMessage.classList.add("visible");
}

function hideMessage() {
  interactionMessage.classList.remove("visible");
}

interactiveElements.forEach((element) => {
  const objectId = element.dataset.object;

  const object = objects[objectId];

  if (!object) {
    return;
  }

  element.addEventListener("mouseenter", () => {
    showMessage(object.message);
  });

  element.addEventListener("mouseleave", () => {
    hideMessage();
  });

  element.addEventListener("click", () => {
    console.log(`Interacción: ${object.name}`);
  });
});
