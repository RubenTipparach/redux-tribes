using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class ShipHealthUI : MonoBehaviour
{
    public Slider healthSlider;
    public Slider energySlider;

    public Color friendlyHealthBarColor;

    public Color enemyHealthBarColor;

    public Color energyBarColor;

    public Image barColor;

    public Image energyBar;

    public String shipName;

    public void Initialize(bool isPlayer, string shipHealthName)
    {
        shipName = shipHealthName;
        
        if (isPlayer)
        {
            barColor.color = friendlyHealthBarColor;
        }
        else
        {
            barColor.color = enemyHealthBarColor;
        }
        healthSlider.value = 1;
        //energyBar.color = energyBarColor;
    }
}
