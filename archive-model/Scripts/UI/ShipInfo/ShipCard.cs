using System;
using System.Collections;
using System.Collections.Generic;
using System.Xml.Serialization;
using TMPro;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public class ShipCard : MonoBehaviour, IPointerEnterHandler, IPointerClickHandler, IPointerExitHandler
{

    public ShipController ship;

    public ShipCardData shipCardData;

    public Image shipImage;

    public TextMeshProUGUI shipName;

    public bool selected = false;

    public BoardingPartyUI boardingPartyUI;


    // Start is called before the first frame update
    void Start()
    {

    }

    // Update is called once per frame
    void Update()
    {
        if (ship.Destroyed)
        {
            gameObject.SetActive(false);
        }
    }

    public void ClearSelection()
    {
        shipImage.color = shipCardData.unselectedColor;
        selected = false;
    }

    public void SetSelected()
    {
        shipImage.color = shipCardData.selectedColor;
        selected = true;
    }

    public void AssignShip(ShipController shipController)
    {
        ship = shipController;

        Debug.Log("setting up: " + ship.transform.name);
        shipCardData = ship.shipCardData;
        shipImage.sprite = shipCardData.shipSprite;
        shipName.text = ship.name;

        ship.shipUiCard = this;

        shipImage.color = shipCardData.unselectedColor;


        shipImage.sprite = ship.shipCardData.shipSprite;
        shipImage.color = ship.shipCardData.factionColor;

    }

    public void OnPointerEnter(PointerEventData eventData)
    {
        if (!selected)
        {
            shipImage.color = shipCardData.highlightcolor;
        }
    }

    public void OnPointerExit(PointerEventData eventData)
    {
        if (!selected)
        {
            shipImage.color = shipCardData.unselectedColor;
        }
        else
        {
            shipImage.color = shipCardData.selectedColor;
        }
    }

    public void OnPointerClick(PointerEventData eventData)
    {
        var targetOnly = eventData.button == PointerEventData.InputButton.Right;
        if (ship.isPlayerShip)
        {

            shipImage.color = shipCardData.selectedColor;
            GameManager.Instance.SelectShip(ship, false);
        }
        else
        {
            GameManager.Instance.SelectShip(ship, false, true, targetOnly);
        }
    }
}
