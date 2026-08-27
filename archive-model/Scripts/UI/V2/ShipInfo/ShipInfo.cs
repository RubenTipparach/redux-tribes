using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class ShipInfo : MonoBehaviour
{

    public TextMeshProUGUI shipName;

    public Image shipInsignia;

    public Slider shipHealth;

    public Slider shipBoardingControl;

    public Button shipButton;

    public void SetShipButton(ShipController ship)
    {
        shipButton.onClick.AddListener(() =>
        {
            GameManager.Instance.ZoomToShip(ship);
        });

        shipName.text = ship.name;
        shipHealth.value = ship.shipHealth.Percent;


        //defenderLeftSlider.value = (float)defenders / total;
        //attackerRightSlider.value = (float)attackers / total;
        shipBoardingControl.value = ship.GetMarineControlPercent;

        // update ship controlling icon.
        shipInsignia.sprite = GameManager.Instance.factionInfoLibrary.GetFactionInfo(ship.shipFaction).factionIcon;
    }

    // update ship values on event?

    private void Start() {
        
    }
}

